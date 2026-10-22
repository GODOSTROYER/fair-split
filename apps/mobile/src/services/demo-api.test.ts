import { randomBytes as nodeRandomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ApprovalSubmission } from "../_shims/api-client";
import type { ApprovalPayload, RunEvent } from "../_shims/contracts";
import { batchSha256, people, runSlug } from "../_shims/seed";
import { approvalBytes, cosign, createSoftwareSigner } from "../lib/signing";
import { createDemoApi } from "./demo-api";

const randomBytes = (n: number) => new Uint8Array(nodeRandomBytes(n));
const now = () => new Date("2026-10-29T10:20:00+08:00");

function setup() {
  const api = createDemoApi({ now, randomBytes });
  const events: RunEvent[] = [];
  api.subscribe(`run:${runSlug}`, (e) => events.push(e));
  const chair = createSoftwareSigner({ keyId: "fs-ernesto-a1", kind: "device", randomBytes });
  return { api, events, chair };
}

async function register(api: ReturnType<typeof setup>["api"], signer: ReturnType<typeof setup>["chair"]) {
  await api.registerDeviceKey({
    keyId: signer.keyId,
    publicKey: await signer.publicKeyHex(),
    kind: "app",
    biometricClass: "biometric-bound",
  });
}

async function chairPayload(api: ReturnType<typeof setup>["api"]): Promise<ApprovalPayload> {
  const p = await api.getApprovalPayload(runSlug, "CHAIR");
  if (!p.ok) throw new Error(p.code);
  return p.value;
}

async function signed(
  signer: ReturnType<typeof setup>["chair"],
  payload: ApprovalPayload,
): Promise<ApprovalSubmission> {
  const s = await signer.sign(approvalBytes(payload), "test");
  if (!s.ok) throw new Error(s.reason);
  return { role: payload.role, keyId: signer.keyId, payload, signature: s.signatureHex };
}

describe("demo server: co-signatures are checked like fs-api checks them", () => {
  it("accepts the Chair's key 2 over the batch on screen and announces it", async () => {
    const { api, events, chair } = setup();
    await register(api, chair);
    const r = await api.getCosignRequest(runSlug);
    if (!r.ok) throw new Error(r.code);
    const { runId, rateCardSha256, itemCount, totalCents } = r.value;
    const result = await cosign(
      await chairPayload(api),
      { runId, rateCardSha256, batchSha256: r.value.batchSha256, itemCount, totalCents, role: "CHAIR" },
      "Sign the Season 2026-A batch",
      { signer: chair, now, submit: (b) => api.postApproval(runSlug, b) },
    );
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toContain("approval.signed");
    const after = await api.getCosignRequest(runSlug);
    expect(after.ok && after.value.state).toBe("signed");
  });

  it("refuses a signature from a key that was never registered", async () => {
    const { api, chair } = setup();
    const r = await api.postApproval(runSlug, await signed(chair, await chairPayload(api)));
    expect(r).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("verifies against the registered public key, never one the request could carry", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const impostor = createSoftwareSigner({ keyId: chair.keyId, kind: "device", randomBytes });
    const r = await api.postApproval(runSlug, await signed(impostor, await chairPayload(api)));
    expect(r).toMatchObject({ ok: false, code: "DIGEST_MISMATCH" });
  });

  it("binds a key to its officer: the Chair's key cannot approve as the treasurer", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const p = await api.getApprovalPayload(runSlug, "TREASURER");
    if (!p.ok) throw new Error(p.code);
    const r = await api.postApproval(runSlug, await signed(chair, p.value));
    expect(r).toMatchObject({ ok: false, code: "UNAUTHENTICATED", status: 403 });
    const forged = await signed(chair, { ...(await chairPayload(api)), approverId: "treasurer:analyn" });
    expect(await api.postApproval(runSlug, forged)).toMatchObject({ ok: false, status: 403 });
  });

  it("inv.i4.server-refuses-changed-batch: a payload for another batch hash is refused", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const p = await chairPayload(api);
    const tampered = { ...p, batchSha256: batchSha256.replace(/^./, (c) => (c === "0" ? "1" : "0")) };
    const r = await api.postApproval(runSlug, await signed(chair, tampered));
    expect(r).toMatchObject({ ok: false, code: "DIGEST_MISMATCH" });
  });

  it("refuses a replayed nonce and a nonce it never issued", async () => {
    const { api, chair } = setup();
    await register(api, chair);
    const first = await signed(chair, await chairPayload(api));
    expect((await api.postApproval(runSlug, first)).ok).toBe(true);
    expect(await api.postApproval(runSlug, first)).toMatchObject({ ok: false, code: "NONCE_REUSED" });
    const invented = await signed(chair, { ...(await chairPayload(api)), nonce: "not-an-issued-nonce" });
    expect(await api.postApproval(runSlug, invented)).toMatchObject({ ok: false, code: "NONCE_REUSED" });
  });

  it("names the Chair as the approver in the payload it issues", async () => {
    const { api } = setup();
    const p = await chairPayload(api);
    expect(p).toMatchObject({ role: "CHAIR", approverId: people.chair.approverId, batchSha256 });
  });
});
