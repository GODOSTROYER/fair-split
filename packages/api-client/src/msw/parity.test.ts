// Parity of the msw handlers with API_COMMANDS: every command is served at its exact method and path, every
// success body parses with its response schema (the typed client validates), every code a command may answer
// comes back as an IC-01 ApiError with the code's HTTP status, and the boundary rules match fs-api's.
import {
  API_COMMANDS,
  type ApiCommandName,
  ApiError,
  apiPath,
  ERROR_HTTP_STATUS,
  HOLD_KINDS,
  type HoldKind,
} from "@fairsplit/contracts";
import { ALLOWED_RESOLUTIONS, linesDigest } from "@fairsplit/domain";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRAND_ROUTES } from "../brand.js";
import { contentDigest } from "../bytes.js";
import { createApiClient } from "../client.js";
import { ApiClientError, ContractError } from "../errors.js";
import { errorCodesOf, isSseCommand, JSON_COMMAND_NAMES, SSE_PATHS } from "../http.js";
import { JUDGE_ROUTES } from "../routes.js";
import { createMockApi, MOCK_ALLOWED_RESOLUTIONS, urlPattern } from "./index.js";
import { linesDigestOf } from "./world.js";

const BASE = "http://localhost:8787";
const TOKEN = `fst_${"p".repeat(43)}`;
const mock = createMockApi({ stage: "approve", pace: "manual", baseUrl: BASE });
const server = setupServer(...mock.handlers);
const api = createApiClient({ baseUrl: BASE, token: TOKEN });

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => {
  server.close();
  mock.world.dispose();
});

const SAMPLE = () => ({
  runSlug: mock.world.runSlug,
  holdId: mock.world.holds()[0]?.id ?? "",
  fieldId: mock.world.fields()[0]?.id ?? "",
  lineId: mock.world.line("M-031")?.id ?? "",
  id: mock.world.runId,
  ws: mock.world.workspaceId,
});

const PAYLOAD = {
  v: 1,
  runId: "0192f8a0-0000-7000-8000-000000000010",
  seasonId: "0192f8a0-0000-7000-8000-000000000011",
  rateCardSha256: "7f3a".repeat(16),
  batchSha256: "91c2".repeat(16),
  linesDigest: "5ab3".repeat(16),
  itemCount: 8,
  totalCents: 36_839,
  currency: "USD",
  role: "treasurer",
  approverId: "treasurer:analyn",
  nonce: "nonce-0001",
  exp: "2026-10-28T02:30:00.000Z",
} as const;

/** A request each command's schema accepts (the failure under test is injected, not a validation error). */
const VALID: Partial<Record<ApiCommandName, { body?: unknown; query?: unknown }>> = {
  createJudgeSession: { body: {} },
  markPaid: { body: {} },
  resolveHold: { body: { resolution: "COUNT_ONCE" } },
  enterField: { body: { value: "64.80" } },
  addDeduction: { body: { label: "Multa", amountText: "₱200" } },
  approvalPayload: { query: { role: "treasurer" } },
  submitApproval: {
    body: { role: "treasurer", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload: PAYLOAD },
  },
  declineApproval: { body: { role: "chair", reason: "Not today" } },
  payCash: { body: {} },
  resend: {
    body: {
      newReceiver: "rhea@example.com",
      keyId: "fs-analyn-w1",
      signature: "ab".repeat(64),
      payload: PAYLOAD,
    },
  },
  capture: {
    body: {
      captureId: "0192f8a0-0000-7000-8000-000000000042",
      sha256: "a".repeat(64),
      mime: "image/jpeg",
      bytes: 1024,
      station: "BODEGA",
      capturedAt: "2026-10-28T01:59:00.000Z",
    },
  },
  createPairing: { body: { persona: "ernesto", role: "board" } },
  claimPairing: { body: { code6: "123456" } },
  presence: { body: { view: "W-TR-07" } },
  createReviewRequest: { body: { lineId: "0192f8a0-0000-7000-8000-000000000003" } },
  setFlag: { body: { flag: "kill_ai_live", on: false } },
  proof: {},
  proofJson: {},
  proofExport: {},
};

describe("msw handlers: parity with API_COMMANDS", () => {
  it("serve every JSON command once, at its exact method and path, plus the four streams and the judge routes", () => {
    const json = (Object.keys(API_COMMANDS) as ApiCommandName[]).filter((n) => !isSseCommand(n));
    expect([...JSON_COMMAND_NAMES].sort()).toEqual(json.sort());
    expect(mock.handlers).toHaveLength(
      json.length +
        Object.keys(SSE_PATHS).length +
        Object.keys(JUDGE_ROUTES).length +
        Object.keys(BRAND_ROUTES).length,
    );
    // a judge or auth route never shadows a command (and the other way round)
    for (const route of Object.values(JUDGE_ROUTES)) {
      const url = `${BASE}${route.path.replace(":sid", "0192f8a0-0000-7000-8000-0000000000ff")}`;
      const shadowed = json.filter(
        (n) => API_COMMANDS[n].method === route.method && urlPattern(API_COMMANDS[n].path, BASE).test(url),
      );
      expect(shadowed, `${route.method} ${route.path}`).toEqual([]);
    }
    for (const name of json) {
      const cmd = API_COMMANDS[name];
      const url = `${BASE}${apiPath(cmd.path, SAMPLE())}`;
      const matching = json.filter((other) => {
        const o = API_COMMANDS[other];
        return o.method === cmd.method && urlPattern(o.path, BASE).test(url);
      });
      expect(matching, `${cmd.method} ${url}`).toEqual([name]);
    }
    expect(urlPattern(API_COMMANDS.proof.path, BASE).test(`${BASE}/v1/proof/2026A-r37.json`)).toBe(false);
    expect(urlPattern(API_COMMANDS.proofJson.path, BASE).test(`${BASE}/v1/proof/2026A-r37.json`)).toBe(true);
  });

  for (const name of JSON_COMMAND_NAMES) {
    it(`${name}: every declared error code is an IC-01 ApiError with its status`, async () => {
      for (const code of errorCodesOf(name)) {
        mock.world.failNext(name, code);
        const r = await api.result(name, { params: SAMPLE(), ...(VALID[name] ?? {}) } as never);
        expect(r.ok, `${name} ${code}`).toBe(false);
        if (r.ok) continue;
        expect(r.error, `${name} ${code}`).toBeInstanceOf(ApiClientError);
        const e = r.error as ApiClientError;
        expect(e.code).toBe(code);
        expect(e.status).toBe(ERROR_HTTP_STATUS[code]);
        expect(ApiError.safeParse(stripExtensions(e.body)).success).toBe(true);
        expect(e.rail).toBe("simulated");
        expect(e.requestId).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  }

  it("refuses to inject a code the command cannot answer", () => {
    expect(() => mock.world.failNext("presence", "DIGEST_MISMATCH")).toThrow(/cannot answer/);
  });

  it("validates like fs-api: 401 without a credential, 400 with located issues, 404 for a foreign id", async () => {
    const anon = createApiClient({ baseUrl: BASE });
    await expect(anon.setFlag({ body: { flag: "kill_ai_live", on: true } })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
    const bad = await api
      .resolveHold({ params: { holdId: SAMPLE().holdId }, body: { resolution: "NOPE" } as never })
      .catch((x: unknown) => x as ApiClientError);
    expect(bad).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    expect((bad as ApiClientError).details.issues).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/^body\.resolution/) }),
    ]);
    const notUuid = await api
      .payCash({ params: { lineId: "not-a-uuid" } })
      .catch((x: unknown) => x as ApiClientError);
    expect(notUuid).toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      api.payCash({ params: { lineId: "0192f8a0-0000-7000-8000-0000000000ff" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const res = await fetch(`${BASE}/v1/captures`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(VALID.capture?.body),
    });
    expect(res.status).toBe(400);
  });

  it("every success body is contract-valid (the client parses each with its response schema)", async () => {
    const fresh = createMockApi({ stage: "invoiced", pace: "manual", baseUrl: BASE });
    server.use(...fresh.handlers);
    const c = createApiClient({ baseUrl: BASE, token: TOKEN });
    const w = fresh.world;
    const seen = new Set<ApiCommandName>();
    const ok = async <T>(name: ApiCommandName, p: Promise<T>) => {
      const v = await p;
      seen.add(name);
      return v;
    };
    await ok("createJudgeSession", c.createJudgeSession());
    await ok("markPaid", c.markPaid({ params: { runSlug: w.runSlug } }));
    w.settle();
    await ok("presence", c.presence({ body: { view: "W-TR-05" } }));
    const gross = w.fields().find((f) => f.field === "gross_kg");
    await ok("enterField", c.enterField({ params: { fieldId: gross?.id ?? "" }, body: { value: "64.80" } }));
    for (const [label, body] of [
      ["H1", { resolution: "COUNT_ONCE" }],
      ["H2", { resolution: "EXCLUDE_LINE", reason: "Plot survey pending" }],
      ["H3", { resolution: "APPLY_RULE", ruleId: "R4" }],
    ] as const) {
      await ok("resolveHold", c.resolveHold({ params: { holdId: w.hold(label)?.id ?? "" }, body }));
    }
    const p1 = await ok(
      "approvalPayload",
      c.approvalPayload({ params: { runSlug: w.runSlug }, query: { role: "treasurer" } }),
    );
    await ok(
      "submitApproval",
      c.submitApproval({
        params: { runSlug: w.runSlug },
        body: { role: "treasurer", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload: p1.payload },
      }),
    );
    await ok(
      "declineApproval",
      c.declineApproval({
        params: { runSlug: w.runSlug },
        body: { role: "chair", reason: "Ask Rhea first" },
      }),
    );
    const body = VALID.capture?.body as never;
    await ok("capture", c.capture({ body }));
    const pairing = await ok(
      "createPairing",
      c.createPairing({ body: { persona: "jessie", role: "clerk" } }),
    );
    await ok("claimPairing", c.claimPairing({ body: { token: pairing.url.split("#t=")[1] ?? "" } }));
    await ok("createReviewRequest", c.createReviewRequest({ body: { lineId: w.line("M-014")?.id ?? "" } }));
    await ok("setFlag", c.setFlag({ body: { flag: "kill_ai_live", on: true } }));
    for (const n of ["proof", "proofJson", "proofExport"] as const) {
      const r = await ok(n, c.call(n, { params: { runSlug: w.runSlug } }));
      expect(r.redacted).toBe(n !== "proofExport");
    }
    // finish the run to reach the line commands
    const fin = createMockApi({ stage: "posted", pace: "manual", baseUrl: BASE });
    server.use(...fin.handlers);
    fin.world.reset("approve");
    const q1 = await c.approvalPayload({
      params: { runSlug: fin.world.runSlug },
      query: { role: "treasurer" },
    });
    await c.submitApproval({
      params: { runSlug: fin.world.runSlug },
      body: { role: "treasurer", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload: q1.payload },
    });
    const q2 = await c.approvalPayload({ params: { runSlug: fin.world.runSlug }, query: { role: "chair" } });
    await c.submitApproval({
      params: { runSlug: fin.world.runSlug },
      body: { role: "chair", keyId: "fs-ernesto-a1", signature: "cd".repeat(64), payload: q2.payload },
    });
    fin.world.settle();
    const rhea = fin.world.line("M-031")?.id ?? "";
    await ok(
      "resend",
      c.resend({
        params: { lineId: rhea },
        body: {
          newReceiver: "rhea@example.com",
          keyId: "fs-analyn-w1",
          signature: "ab".repeat(64),
          payload: PAYLOAD,
        },
      }),
    );
    fin.world.reset("settled");
    const cash = fin.world.lines().find((l) => l.rail === "CASH" && l.state === "OFF_RAIL_DUE");
    expect(cash).toBeDefined();
    const unclaimedWorld = createMockApi({ stage: "approve", pace: "manual", baseUrl: BASE });
    server.use(...unclaimedWorld.handlers);
    const u = unclaimedWorld.world;
    const a1 = await c.approvalPayload({ params: { runSlug: u.runSlug }, query: { role: "treasurer" } });
    await c.submitApproval({
      params: { runSlug: u.runSlug },
      body: { role: "treasurer", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload: a1.payload },
    });
    const a2 = await c.approvalPayload({ params: { runSlug: u.runSlug }, query: { role: "chair" } });
    await c.submitApproval({
      params: { runSlug: u.runSlug },
      body: { role: "chair", keyId: "fs-ernesto-a1", signature: "cd".repeat(64), payload: a2.payload },
    });
    u.settle();
    await ok("payCash", c.payCash({ params: { lineId: u.line("M-031")?.id ?? "" } }));
    seen.add("addDeduction"); // never succeeds by contract (always 409 RATE_CARD_RATIFIED; see world.test.ts)
    expect([...seen].sort()).toEqual([...JSON_COMMAND_NAMES].sort());
    for (const m of [fresh, fin, unclaimedWorld]) m.world.dispose();
  });

  it("a body that breaks the contract surfaces as a ContractError, never as data", async () => {
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post(urlPattern(API_COMMANDS.presence.path, BASE), () => HttpResponse.json({ ok: "yes" })),
    );
    const e = await api.presence({ body: { view: "x" } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContractError);
  });

  it("the mock's approval payload signs linesDigest exactly as IC-02 does: every member line, by member number", async () => {
    const fresh = createMockApi({ stage: "approve", pace: "manual", baseUrl: BASE });
    server.use(...fresh.handlers);
    try {
      const { payload } = await api.approvalPayload({
        params: { runSlug: fresh.world.runSlug },
        query: { role: "treasurer" },
      });
      const lines = fresh.world.lines().map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }));
      expect(lines.length).toBeGreaterThan(payload.itemCount);
      expect(payload.linesDigest).toBe(linesDigest(lines));
      expect(linesDigestOf([...lines].reverse())).toBe(linesDigest(lines));
    } finally {
      server.resetHandlers();
      fresh.world.dispose();
    }
  });

  it("the mock's allowed resolutions are the engine's", () => {
    for (const kind of HOLD_KINDS as readonly HoldKind[]) {
      expect([...MOCK_ALLOWED_RESOLUTIONS[kind]].sort(), kind).toEqual([...ALLOWED_RESOLUTIONS[kind]].sort());
    }
  });

  it("captures carry the client's Content-Digest over the exact body", () => {
    const text = JSON.stringify(VALID.capture?.body);
    expect(contentDigest(text)).toMatch(/^sha-256=:[A-Za-z0-9+/]{43}=:$/);
  });
});

function stripExtensions(body: unknown): unknown {
  const keys = ["code", "status", "message", "requestId", "retryAfterMs", "paypalDebugId", "details"];
  return Object.fromEntries(Object.entries(body as object).filter(([k]) => keys.includes(k)));
}
