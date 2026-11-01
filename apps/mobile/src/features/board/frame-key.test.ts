import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalSubmission } from "../../_shims/api-client";
import { jcs } from "../../_shims/domain";
import { approvalBytes, createDemoVault, type KeyMeta } from "../../lib/signing";
import { buildDemoApproval, buildDemoCosign } from "../../services/demo-fixtures";
import { type PairedSession, pairingId } from "../../services/session";
import { createFrameKeyAdapter, createFrameKeyRegistry } from "./frame-key";

const session: PairedSession = {
  kind: "frame",
  bearer: "test-frame",
  expiresAt: "2099-01-01T00:00:00Z",
  workspaceId: "judge-workspace",
  persona: "board:ernesto",
  role: "board",
  memberNo: null,
  displayName: "Ernesto",
  lang: "en",
  pairedAt: "2026-11-01T00:00:00Z",
};

async function setup(registry = createFrameKeyRegistry(), pairedSession = session) {
  const session = pairedSession;
  const vault = createDemoVault((n) => new Uint8Array(randomBytes(n)));
  let current: PairedSession | null = session;
  const payload = {
    ...buildDemoApproval(buildDemoCosign({ now: new Date(), treasurerSigned: true }), {
      role: "chair",
      nonce: "test-nonce-chair",
      exp: "2099-01-01T00:00:00Z",
    }).payload,
    approverId: session.persona,
  };
  const sign = (message: Uint8Array) =>
    vault.sign({
      persona: session.persona,
      pairing: pairingId(session),
      message,
      prompt: "",
      cancelLabel: "",
    });
  const signed = await sign(approvalBytes(payload));
  if (!signed.ok) throw new Error("fixture key unavailable");
  const registerFrameKey = vi.fn(async (body: { publicKeyHex: string; signatureHex: string }) => ({
    ok: true as const,
    value: {
      keyId: `fs-${session.persona.split(":")[1]}-demo-server`,
      publicKeyHex: body.publicKeyHex,
      approverId: session.persona,
      kind: "web_demo" as const,
      label: "Demo key (this browser only)",
    },
  }));
  const postApproval = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }));
  const opts = {
    api: { registerFrameKey, postApproval },
    registry,
    session,
    currentSession: () => current,
    vaultKind: vault.kind,
    sign,
    runSlug: "test-run",
  };
  const adapter = createFrameKeyAdapter(opts);
  const submission: ApprovalSubmission = {
    keyId: signed.key.keyId,
    role: "chair",
    payload,
    signature: signed.signatureHex,
  };
  return {
    adapter,
    opts,
    signed,
    submission,
    registerFrameKey,
    postApproval,
    setSession: (s: PairedSession | null) => {
      current = s;
    },
  };
}

describe("Chair frame key registration", () => {
  it("a paired browser device token and another board persona use the same proof protocol", async () => {
    const f = await setup(undefined, { ...session, kind: "device", persona: "board:theresa" });
    expect(await f.adapter.register(f.signed.key)).toEqual({ ok: true, value: { ok: true } });
    expect(f.adapter.serverKeyId(f.signed.key.keyId)).toBe("fs-theresa-demo-server");
    expect((await f.adapter.submit(f.submission)).ok).toBe(true);
    expect(f.postApproval).toHaveBeenCalledWith("test-run", {
      ...f.submission,
      keyId: "fs-theresa-demo-server",
    });
  });
  it("proves possession using fs-api's canonical statement and submits the server's assigned key ID", async () => {
    const f = await setup();
    expect(await f.adapter.register(f.signed.key)).toEqual({ ok: true, value: { ok: true } });
    const body = f.registerFrameKey.mock.calls[0]?.[0];
    expect(body?.publicKeyHex).toBe(f.signed.key.publicKeyHex);
    expect(
      body &&
        ed25519.verify(
          hexToBytes(body.signatureHex),
          utf8ToBytes(
            jcs({
              v: 1,
              purpose: "fs.register-demo-key",
              ws: session.workspaceId,
              approverId: session.persona,
              publicKeyHex: f.signed.key.publicKeyHex,
            }),
          ),
          hexToBytes(body.publicKeyHex),
        ),
    ).toBe(true);
    expect(f.adapter.isRegistered(f.signed.key.keyId)).toBe(true);
    expect(await f.adapter.submit(f.submission)).toEqual({ ok: true, value: { accepted: true } });
    expect(f.postApproval).toHaveBeenCalledWith("test-run", {
      ...f.submission,
      keyId: "fs-ernesto-demo-server",
    });
  });

  it("inv.i6.frame-proof-key: a vault that changes keys while proving possession registers nothing", async () => {
    const f = await setup();
    const sign = vi.fn(async () => ({ ...f.signed, key: { ...f.signed.key, publicKeyHex: "0".repeat(64) } }));
    const a = createFrameKeyAdapter({ ...f.opts, sign });
    expect((await a.register(f.signed.key)).ok).toBe(false);
    expect(f.registerFrameKey).not.toHaveBeenCalled();
  });

  it("refuses an invalid possession signature before calling fs-api", async () => {
    const f = await setup();
    const a = createFrameKeyAdapter({
      ...f.opts,
      sign: async () => ({ ...f.signed, signatureHex: "0".repeat(128) }),
    });
    expect((await a.register(f.signed.key)).ok).toBe(false);
    expect(f.registerFrameKey).not.toHaveBeenCalled();
  });

  it("inv.i6.frame-pairing: a changed session during proof cannot register or submit", async () => {
    const f = await setup();
    const a = createFrameKeyAdapter({
      ...f.opts,
      sign: async (m: Uint8Array) => {
        const result = await f.opts.sign(m);
        f.setSession({ ...session, bearer: "replacement-frame" });
        return result;
      },
    });
    expect((await a.register(f.signed.key)).ok).toBe(false);
    expect((await a.submit(f.submission)).ok).toBe(false);
    expect(f.registerFrameKey).not.toHaveBeenCalled();
    expect(f.postApproval).not.toHaveBeenCalled();
  });

  it("a changed session while registration is in flight does not cache the response", async () => {
    const f = await setup();
    f.registerFrameKey.mockImplementationOnce(async (body) => {
      f.setSession(null);
      return {
        ok: true,
        value: {
          keyId: "fs-ernesto-demo-server",
          publicKeyHex: body.publicKeyHex,
          approverId: session.persona,
          kind: "web_demo",
          label: "Demo key",
        },
      };
    });
    expect((await f.adapter.register(f.signed.key)).ok).toBe(false);
    f.setSession(session);
    expect(f.adapter.isRegistered(f.signed.key.keyId)).toBe(false);
  });

  it("a later token session cannot reuse the earlier session's local-to-server mapping", async () => {
    const f = await setup();
    await f.adapter.register(f.signed.key);
    const next = { ...session, bearer: "replacement-frame" };
    f.setSession(next);
    const later = createFrameKeyAdapter({ ...f.opts, session: next });
    expect(later.isRegistered(f.signed.key.keyId)).toBe(false);
    expect((await later.submit(f.submission)).ok).toBe(false);
    expect(f.postApproval).not.toHaveBeenCalled();
  });

  it("refuses a registration response for another key or approver", async () => {
    const f = await setup();
    f.registerFrameKey.mockResolvedValueOnce({
      ok: true,
      value: {
        keyId: "fs-ernesto-demo-server",
        publicKeyHex: "0".repeat(64),
        approverId: "treasurer:analyn",
        kind: "web_demo",
        label: "Demo key",
      },
    });
    expect((await f.adapter.register(f.signed.key)).ok).toBe(false);
    expect(f.adapter.isRegistered(f.signed.key.keyId)).toBe(false);
  });

  it("inv.i4.frame-submission: the registered key must verify the actual submitted approval", async () => {
    const f = await setup();
    await f.adapter.register(f.signed.key);
    expect((await f.adapter.submit({ ...f.submission, signature: "0".repeat(128) })).ok).toBe(false);
    expect(f.postApproval).not.toHaveBeenCalled();
  });

  it("live native keys refuse the web route, and an unmapped local key never submits", async () => {
    const f = await setup();
    const native = createFrameKeyAdapter({ ...f.opts, vaultKind: "device" });
    expect((await native.register(f.signed.key as KeyMeta)).ok).toBe(false);
    expect((await f.adapter.submit(f.submission)).ok).toBe(false);
    expect(f.registerFrameKey).not.toHaveBeenCalled();
    expect(f.postApproval).not.toHaveBeenCalled();
  });
});
