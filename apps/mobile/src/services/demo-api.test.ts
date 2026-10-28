import { randomBytes as nodeRandomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import type { ApprovalSubmission } from "../_shims/api-client";
import type { ApprovalPayload, DeviceKeyKind, RunEvent } from "../_shims/contracts";
import { jcs } from "../_shims/domain";
import { batchSha256, linesDigest, people, runSlug } from "../_shims/seed";
import { checkApprovalPayload, checkCosignRequest } from "../lib/signing";
import { createDemoApi } from "./demo-api";

const randomBytes = (n: number) => new Uint8Array(nodeRandomBytes(n));
const now = () => new Date("2026-10-29T10:20:00+08:00");

/** A test key, written here so the server's checks are tested independently of the phone's signing code. */
function testKey(keyId = "fs-ernesto-a1") {
  const sk = randomBytes(32);
  return {
    keyId,
    publicKey: bytesToHex(ed25519.getPublicKey(sk)),
    sign: (p: ApprovalPayload): ApprovalSubmission => ({
      role: p.role,
      keyId,
      payload: p,
      signature: bytesToHex(ed25519.sign(utf8ToBytes(jcs(p)), sk)),
    }),
  };
}

function setup() {
  const api = createDemoApi({ now, randomBytes });
  const events: RunEvent[] = [];
  api.subscribe(`run:${runSlug}`, (e) => events.push(e));
  return { api, events, chair: testKey() };
}

async function register(
  api: ReturnType<typeof setup>["api"],
  key: ReturnType<typeof testKey>,
  kind: DeviceKeyKind = "app",
) {
  return api.registerDeviceKey({
    keyId: key.keyId,
    publicKey: key.publicKey,
    kind,
    biometricClass: kind === "app" ? "biometric-bound" : "none",
  });
}

async function chairPayload(api: ReturnType<typeof setup>["api"]): Promise<ApprovalPayload> {
  const p = await api.getApprovalPayload(runSlug, "chair");
  if (!p.ok) throw new Error(p.code);
  return p.value.payload;
}

describe("demo server: co-signatures are checked like fs-api checks them", () => {
  it("accepts the Chair's key 2 over the payload it issued and announces it", async () => {
    const { api, events, chair } = setup();
    await register(api, chair);
    const r = await api.postApproval(runSlug, chair.sign(await chairPayload(api)));
    expect(r).toEqual({ ok: true, value: { accepted: true } });
    expect(events.map((e) => e.type)).toContain("approval.signed");
    const after = await api.getCosignRequest(runSlug);
    expect(after.ok && after.value.state).toBe("signed");
  });

  it("refuses a signature from a key that was never registered", async () => {
    const { api, chair } = setup();
    const r = await api.postApproval(runSlug, chair.sign(await chairPayload(api)));
    expect(r).toMatchObject({ ok: false, code: "KEY_NOT_REGISTERED", status: 403 });
  });

  it("verifies against the registered public key, never one the request could carry", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const impostor = testKey(chair.keyId);
    const r = await api.postApproval(runSlug, impostor.sign(await chairPayload(api)));
    expect(r).toMatchObject({ ok: false, code: "SIGNATURE_INVALID", status: 422 });
  });

  it("binds a key to its officer: the Chair's key cannot approve as the treasurer", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const p = await api.getApprovalPayload(runSlug, "treasurer");
    if (!p.ok) throw new Error(p.code);
    const r = await api.postApproval(runSlug, chair.sign(p.value.payload));
    expect(r).toMatchObject({ ok: false, code: "APPROVER_MISMATCH", status: 403 });
    const forged = chair.sign({ ...(await chairPayload(api)), approverId: "treasurer:analyn" });
    expect(await api.postApproval(runSlug, forged)).toMatchObject({ ok: false, status: 403 });
  });

  it("inv.i4.server-refuses-changed-batch: a payload for another batch hash is refused", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const p = await chairPayload(api);
    const tampered = { ...p, batchSha256: batchSha256.replace(/^./, (c) => (c === "0" ? "1" : "0")) };
    const r = await api.postApproval(runSlug, chair.sign(tampered));
    expect(r).toMatchObject({ ok: false, code: "DIGEST_MISMATCH" });
  });

  it("inv.i4.server-refuses-moved-cent: a payload whose lines digest moved one cent is refused", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const p = await chairPayload(api);
    const r = await api.postApproval(runSlug, chair.sign({ ...p, linesDigest: "e".repeat(64) }));
    expect(r).toMatchObject({ ok: false, code: "DIGEST_MISMATCH" });
  });

  it("refuses a replayed nonce and a nonce it never issued", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const first = chair.sign(await chairPayload(api));
    expect((await api.postApproval(runSlug, first)).ok).toBe(true);
    expect(await api.postApproval(runSlug, first)).toMatchObject({ ok: false, code: "NONCE_REUSED" });
    const invented = chair.sign({ ...(await chairPayload(api)), nonce: "not-an-issued-nonce" });
    expect(await api.postApproval(runSlug, invented)).toMatchObject({ ok: false, code: "NONCE_REUSED" });
  });

  it("refuses an expired payload", async () => {
    let t = now();
    const api = createDemoApi({ now: () => t, randomBytes });
    const chair = testKey();
    await register(api, chair);
    const p = await chairPayload(api);
    t = new Date(t.getTime() + 16 * 60_000); // payloads expire after 15 minutes
    expect(await api.postApproval(runSlug, chair.sign(p))).toMatchObject({
      ok: false,
      code: "APPROVAL_EXPIRED",
      status: 422,
    });
  });

  it("names the Chair as the approver in the payload it issues", async () => {
    const { api } = setup();
    const p = await chairPayload(api);
    expect(p).toMatchObject({ role: "chair", approverId: people.chair.approverId, batchSha256, linesDigest });
  });

  it("answers with the items and the 64 member lines its payload binds, which the phone recomputes", async () => {
    const { api } = setup();
    const req = await api.getCosignRequest(runSlug);
    const answer = await api.getApprovalPayload(runSlug, "chair");
    if (!req.ok || !answer.ok) throw new Error("the demo run is open");
    expect(answer.value.lines).toHaveLength(64);
    expect(answer.value.jcs).toBe(jcs(answer.value.payload));
    const opened = checkCosignRequest(req.value);
    if (!opened.ok) throw new Error(opened.problem);
    expect(checkApprovalPayload(answer.value, opened.expected, now())).toMatchObject({ ok: true });
  });

  it("registers a key only under its kind's ID shape, and never re-registers an ID with another key", async () => {
    const { api, chair } = setup();
    expect(await register(api, chair, "web_demo")).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(await register(api, testKey("fs-ernesto-demo-k3x9pq"), "app")).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await register(api, chair)).toEqual({ ok: true, value: { ok: true } });
    expect(await register(api, chair)).toEqual({ ok: true, value: { ok: true } }); // idempotent
    expect(await register(api, testKey(chair.keyId))).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
  });

  it("accepts a judge's labelled browser key, kind web_demo (C-13)", async () => {
    const { api } = setup();
    const judge = testKey("fs-ernesto-demo-k3x9pq");
    expect(await register(api, judge, "web_demo")).toEqual({ ok: true, value: { ok: true } });
    expect(await api.postApproval(runSlug, judge.sign(await chairPayload(api)))).toEqual({
      ok: true,
      value: { accepted: true },
    });
  });
});

describe("demo controller: item statuses only move forward (I5)", () => {
  it("emits PayPal's item events in order and moves a parked line to cash on the co-op's own action", () => {
    const api = createDemoApi({ now, randomBytes });
    const seen: string[] = [];
    api.subscribe(`run:${runSlug}`, (e) => {
      const p = e.payload as { status?: string; state?: string };
      seen.push(`${e.type}:${p.status ?? p.state}`);
    });
    api.demo.advance("sent");
    api.demo.advance("unclaimed");
    api.demo.advance("cash-due");
    api.demo.advance("cash-received");
    expect(seen).toEqual([
      "item.updated:PENDING",
      "item.updated:UNCLAIMED",
      "line.state:OFF_RAIL_DUE",
      "line.state:OFF_RAIL_PAID",
    ]);
    expect(api.demo.stage()).toBe("cash-received");
  });
});
