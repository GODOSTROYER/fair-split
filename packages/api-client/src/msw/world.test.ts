// The hero path on the mock API, driven through the typed client exactly as the console will drive fs-api.
import { ed25519 } from "@noble/curves/ed25519.js";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fromHex, toHex, utf8 } from "../bytes.js";
import { createApiClient } from "../client.js";
import { ApiClientError, asRateCardRatified } from "../errors.js";
import { createMockApi } from "./index.js";

const BASE = "http://localhost:8787";
let clock = new Date("2026-10-28T02:00:00.000Z");
const mock = createMockApi({ stage: "invoiced", pace: "manual", baseUrl: BASE, now: () => clock });
const server = setupServer(...mock.handlers);

// Two officers' device keys (the Chair's `a` key would live in SecureStore; these are test seeds).
const keys = {
  "fs-analyn-w1": fromHex("11".repeat(32)),
  "fs-ernesto-a1": fromHex("22".repeat(32)),
} as const;
const publicKeys = Object.fromEntries(
  Object.entries(keys).map(([id, seed]) => [id, toHex(ed25519.getPublicKey(seed))]),
);

function sign(keyId: keyof typeof keys, jcs: string): string {
  return toHex(ed25519.sign(utf8(jcs), keys[keyId]));
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  mock.world.dispose();
});

describe("mock world: the hero path through the typed client", () => {
  const anon = createApiClient({ baseUrl: BASE });
  let api = createApiClient({ baseUrl: BASE });

  it("starts a judge session (201, then a 200 resume) and funds the run on the simulated rail", async () => {
    const r = await anon.result("createJudgeSession");
    expect(r.ok && r.meta.status).toBe(201);
    if (!r.ok) throw r.error;
    expect(r.meta.rail).toBe("simulated");
    expect((await anon.result("createJudgeSession")).ok && anon.rail).toBe("simulated");
    api = createApiClient({ baseUrl: BASE, token: r.data.consoleToken });

    const paid = await api.markPaid({ params: { runSlug: r.data.runSlug } });
    expect(paid).toMatchObject({
      runState: "FUNDED",
      invoiceStatus: "MARKED_AS_PAID",
      provenance: "simulated_rail",
    });
    await expect(api.markPaid({ params: { runSlug: r.data.runSlug } })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      status: 409,
    });
    expect(mock.world.run.state).toBe("FUNDED");
    mock.world.settle();
    expect(mock.world.run.state).toBe("IN_REVIEW");
    expect(mock.world.holds().map((h) => h.label)).toEqual(["H1", "H2", "H3", "Slip 0462 by hand"]);
  });

  it("refuses to build an approval while a blocking hold is open", async () => {
    const e = await api
      .approvalPayload({ params: { runSlug: mock.world.runSlug }, query: { role: "treasurer" } })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiClientError);
    expect((e as ApiClientError).code).toBe("BLOCKING_HOLDS_OPEN");
  });

  it("MM-4: an edit to the ratified card is a 409 citing the hash", async () => {
    const e = await api
      .addDeduction({ params: { id: mock.world.runId }, body: { label: "Multa", amountText: "₱200" } })
      .catch((x: unknown) => x);
    const refusal = asRateCardRatified(e);
    expect(refusal?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(refusal?.ratifiedOn).toBe("2026-03-14");
  });

  it("slip 0462 by hand: net derives from gross, the logbook agrees, and the dial opens", async () => {
    const gross = mock.world.fields().find((f) => f.field === "gross_kg");
    expect(gross?.displayMerge).toBe("6?.80");
    const r = await api.enterField({ params: { fieldId: gross?.id ?? "" }, body: { value: "64.80" } });
    expect(r.derived).toEqual({ net_kg: "64.50" });
    expect(r.logbookMatch).toBe(true);
    expect(r.matchesReadPattern).toBe(true);
    expect(mock.world.hold("Slip 0462 by hand")?.state).toBe("RESOLVED");
    expect(mock.world.hold("Mass balance")?.state).toBe("OPEN");
  });

  it("MM-3: counting slip 0457 once clears the mass-balance dial; H2 and H3 resolve in ink", async () => {
    const h1 = mock.world.hold("H1");
    const r = await api.resolveHold({ params: { holdId: h1?.id ?? "" }, body: { resolution: "COUNT_ONCE" } });
    expect(r.hold.state).toBe("RESOLVED");
    expect(r.hold.resolution?.by).toBe("AS");
    expect(mock.world.hold("Mass balance")?.resolution?.kind).toBe("ENGINE_CLEARED");
    await expect(
      api.resolveHold({ params: { holdId: h1?.id ?? "" }, body: { resolution: "COUNT_ONCE" } }),
    ).rejects.toMatchObject({ code: "HOLD_NOT_OPEN" });
    const h2 = mock.world.hold("H2");
    await expect(
      api.resolveHold({ params: { holdId: h2?.id ?? "" }, body: { resolution: "RETURN_AS_CREDIT" } }),
    ).rejects.toMatchObject({ code: "RESOLUTION_NOT_ALLOWED", status: 422 });
    await api.resolveHold({
      params: { holdId: h2?.id ?? "" },
      body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.80", trees: 400 } },
    });
    await api.resolveHold({
      params: { holdId: mock.world.hold("H3")?.id ?? "" },
      body: { resolution: "RETURN_AS_CREDIT" },
    });
    expect(mock.world.holds().every((h) => h.state === "RESOLVED")).toBe(true);
  });

  it("MM-5: two keys from two people sign one batch hash; the Chair is needed over US$300", async () => {
    const slug = mock.world.runSlug;
    const p1 = await api.approvalPayload({ params: { runSlug: slug }, query: { role: "treasurer" } });
    expect(p1.payload.itemCount).toBe(8);
    expect(p1.jcs.startsWith('{"approverId":"treasurer:analyn"')).toBe(true);
    const k1 = await api.submitApproval({
      params: { runSlug: slug },
      body: {
        role: "treasurer",
        keyId: "fs-analyn-w1",
        signature: sign("fs-analyn-w1", p1.jcs),
        payload: p1.payload,
      },
    });
    expect(k1).toMatchObject({ runState: "AWAITING_BOARD", needsChair: true });
    expect(k1.approval.keyLabel).toBe("Demo key (this browser)");
    // the same payload cannot be signed twice
    await expect(
      api.submitApproval({
        params: { runSlug: slug },
        body: {
          role: "treasurer",
          keyId: "fs-analyn-w1",
          signature: sign("fs-analyn-w1", p1.jcs),
          payload: p1.payload,
        },
      }),
    ).rejects.toMatchObject({ code: "NONCE_REUSED" });

    const p2 = await api.approvalPayload({ params: { runSlug: slug }, query: { role: "chair" } });
    // a tampered batch hash is refused before anything is signed (I4)
    const tampered = { ...p2.payload, batchSha256: "0".repeat(64) };
    await expect(
      api.submitApproval({
        params: { runSlug: slug },
        body: {
          role: "chair",
          keyId: "fs-ernesto-a1",
          signature: sign("fs-ernesto-a1", p2.jcs),
          payload: tampered,
        },
      }),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    // the treasurer's key cannot sign for the Chair
    await expect(
      api.submitApproval({
        params: { runSlug: slug },
        body: {
          role: "chair",
          keyId: "fs-analyn-w1",
          signature: sign("fs-analyn-w1", p2.jcs),
          payload: p2.payload,
        },
      }),
    ).rejects.toMatchObject({ code: "KEY_NOT_REGISTERED", status: 403 });
    const k2 = await api.submitApproval({
      params: { runSlug: slug },
      body: {
        role: "chair",
        keyId: "fs-ernesto-a1",
        signature: sign("fs-ernesto-a1", p2.jcs),
        payload: p2.payload,
      },
    });
    expect(k2).toMatchObject({ runState: "APPROVED", needsChair: false });
    expect(k2.approval.keyLabel).toBe("Device key");
  });

  it("MM-6: the batch posts and fans out; Rhea's item parks UNCLAIMED and moves to cash", async () => {
    mock.world.settle();
    expect(mock.world.run.state).toBe("NEEDS_FOLLOW_UP");
    const paid = mock.world.lines().filter((l) => l.state === "PAID");
    expect(paid).toHaveLength(7);
    const rhea = mock.world.line("M-031");
    expect(rhea?.state).toBe("UNCLAIMED");
    const r = await api.payCash({ params: { lineId: rhea?.id ?? "" } });
    expect(r).toMatchObject({ cancelled: true, line: { state: "OFF_RAIL_DUE", memberNo: "M-031" } });
    expect(mock.world.run.state).toBe("SETTLED");
    const items = mock.world.events().filter((e) => e.type === "item.updated");
    expect(items.every((e) => e.provenance === "simulated_rail")).toBe(true);
    expect(new Set(items.map((e) => Number(e.id))).size).toBe(items.length);
  });

  it("the events replay in order from any Last-Event-ID over SSE", async () => {
    const all = mock.world.events();
    const from = all[Math.floor(all.length / 2)]?.id ?? "0";
    const got: string[] = [];
    const sub = api.subscribe(
      { kind: "run", runSlug: mock.world.runSlug },
      { onEvent: (e) => got.push(e.id) },
      { lastEventId: from },
    );
    await waitFor(() => got.length === all.filter((e) => Number(e.id) > Number(from)).length);
    sub.close();
    await sub.done;
    expect(got).toEqual(all.filter((e) => Number(e.id) > Number(from)).map((e) => e.id));
  });
});

describe("mock world: refusals a screen must handle", () => {
  it("the kill switch halts a signed run and refuses key 2 (423)", async () => {
    const m = createMockApi({ stage: "approve", pace: "manual", baseUrl: BASE, now: () => clock });
    server.use(...m.handlers);
    const api = createApiClient({ baseUrl: BASE, token: `fst_${"a".repeat(43)}` });
    const slug = m.world.runSlug;
    const p1 = await api.approvalPayload({ params: { runSlug: slug }, query: { role: "treasurer" } });
    await api.submitApproval({
      params: { runSlug: slug },
      body: {
        role: "treasurer",
        keyId: "fs-analyn-w1",
        signature: sign("fs-analyn-w1", p1.jcs),
        payload: p1.payload,
      },
    });
    const flag = await api.setFlag({ body: { flag: "kill_payouts", on: true } });
    expect(flag.flag).toMatchObject({ flag: "kill_payouts", on: true });
    expect(m.world.run.state).toBe("HALTED");
    expect(m.world.approvals().every((a) => a.voidedAt !== null)).toBe(true);
    const e = await api
      .submitApproval({
        params: { runSlug: slug },
        body: {
          role: "chair",
          keyId: "fs-ernesto-a1",
          signature: "ab".repeat(64),
          payload: { ...p1.payload, role: "chair", approverId: "board:ernesto" },
        },
      })
      .catch((x: unknown) => x as ApiClientError);
    expect(e).toMatchObject({ code: "KILL_SWITCH_ON", status: 423 });
    m.world.dispose();
  });

  it("verifies signatures when given keys, and expires payloads after 30 minutes", async () => {
    const m = createMockApi({
      stage: "approve",
      pace: "manual",
      baseUrl: BASE,
      now: () => clock,
      verifySignature: ({ keyId, payloadJcs, signatureHex }) => {
        const pub = publicKeys[keyId];
        return !!pub && ed25519.verify(fromHex(signatureHex), utf8(payloadJcs), fromHex(pub));
      },
    });
    server.use(...m.handlers);
    const api = createApiClient({ baseUrl: BASE, token: `fst_${"b".repeat(43)}` });
    const slug = m.world.runSlug;
    const p = await api.approvalPayload({ params: { runSlug: slug }, query: { role: "treasurer" } });
    await expect(
      api.submitApproval({
        params: { runSlug: slug },
        body: {
          role: "treasurer",
          keyId: "fs-analyn-w1",
          signature: sign("fs-ernesto-a1", p.jcs),
          payload: p.payload,
        },
      }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    clock = new Date(clock.getTime() + 31 * 60_000);
    await expect(
      api.submitApproval({
        params: { runSlug: slug },
        body: {
          role: "treasurer",
          keyId: "fs-analyn-w1",
          signature: sign("fs-analyn-w1", p.jcs),
          payload: p.payload,
        },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    m.world.dispose();
  });

  it("captures: Content-Digest is computed by the client; retries and twins are recognised", async () => {
    const m = createMockApi({ stage: "review", pace: "manual", baseUrl: BASE, now: () => clock });
    server.use(...m.handlers);
    const api = createApiClient({ baseUrl: BASE, token: `fst_${"c".repeat(43)}` });
    const body = {
      captureId: "0192f8a0-0000-7000-8000-0000000000a1",
      sha256: "ab".repeat(32),
      mime: "image/jpeg" as const,
      bytes: 2048,
      station: "BODEGA" as const,
      capturedAt: "2026-10-28T01:59:00.000Z",
    };
    const first = await api.result("capture", { body });
    expect(first.ok && first.meta.status).toBe(201);
    expect(await api.capture({ body })).toMatchObject({ status: "already_received" });
    const twin = await api.capture({ body: { ...body, captureId: "0192f8a0-0000-7000-8000-0000000000a2" } });
    expect(twin).toMatchObject({
      status: "exact_duplicate",
      exactDuplicateOf: first.ok ? first.data.documentId : "",
    });
    const raw = await fetch(`${BASE}/v1/captures`, {
      method: "POST",
      headers: {
        authorization: `Bearer fst_${"c".repeat(43)}`,
        "content-type": "application/json",
        "idempotency-key": body.captureId,
        "content-digest": "sha-256=:AAAA:",
      },
      body: JSON.stringify(body),
    });
    expect(raw.status).toBe(422);
    expect(await raw.json()).toMatchObject({ code: "CONTENT_DIGEST_MISMATCH" });
    m.world.dispose();
  });

  it("pairing is single use; presence is at most 1 Hz", async () => {
    const m = createMockApi({ stage: "review", pace: "manual", baseUrl: BASE, now: () => clock });
    server.use(...m.handlers);
    const api = createApiClient({ baseUrl: BASE, token: `fst_${"d".repeat(43)}` });
    const pairing = await api.createPairing({ body: { persona: "ernesto", role: "board" } });
    expect(pairing.url).toMatch(/\/app\/pair#t=/);
    const claim = await createApiClient({ baseUrl: BASE }).claimPairing({ body: { code6: pairing.code6 } });
    expect(claim).toMatchObject({ role: "board", persona: "ernesto", workspaceId: m.world.workspaceId });
    expect(claim.token.startsWith("fsd_")).toBe(true);
    await expect(
      createApiClient({ baseUrl: BASE }).claimPairing({ body: { code6: pairing.code6 } }),
    ).rejects.toMatchObject({
      code: "PAIRING_TOKEN_INVALID",
      status: 410,
    });
    const phone = createApiClient({ baseUrl: BASE, token: claim.token });
    await phone.presence({ body: { view: "M-BD-01" } });
    const e = (await phone
      .presence({ body: { view: "M-BD-01" } })
      .catch((x: unknown) => x)) as ApiClientError;
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.retryAfterMs).toBeGreaterThan(0);
    expect(m.world.events().filter((x) => x.type === "presence")).toHaveLength(1);
    m.world.dispose();
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 3_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
