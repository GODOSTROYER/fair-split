/**
 * fs-api assigns a browser key's ID. Keep that ID beside the local vault ID in memory for this pairing only.
 * Registration proves possession with the very same key that signed the approval; no key or signature queues.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { FairSplitApi } from "../../_shims/api-client";
import { jcs, jcsSha256 } from "../../_shims/domain";
import { type CosignDeps, type KeyVault, verifyApproval } from "../../lib/signing";
import { type PairedSession, pairingId, sessionValid } from "../../services/session";

interface RegisteredFrameKey {
  serverKeyId: string;
  publicKeyHex: string;
}

/** Public keys and opaque IDs only; this registry never persists and never holds a secret key. */
export function createFrameKeyRegistry() {
  return new Map<string, RegisteredFrameKey>();
}

interface FrameKeyOptions {
  api: Pick<FairSplitApi, "registerFrameKey" | "postApproval">;
  registry: ReturnType<typeof createFrameKeyRegistry>;
  session: PairedSession;
  currentSession(): PairedSession | null;
  vaultKind: KeyVault["kind"];
  sign: CosignDeps["sign"];
  runSlug: string;
}

const forbidden = { ok: false, code: "FORBIDDEN" } as const;
const invalidSignature = { ok: false, code: "SIGNATURE_INVALID" } as const;

/** The live browser seam used by useSign; native enrollment is a separate protocol, never the old shim route. */
export function createFrameKeyAdapter(o: FrameKeyOptions): Pick<
  CosignDeps,
  "isRegistered" | "register" | "submit"
> & {
  serverKeyId(localKeyId: string): string | null;
} {
  const pairing = pairingId(o.session);
  // A token renewal is a new session boundary even when the persona and pairing date were preserved.
  const sessionId = jcsSha256({ pairing, bearer: o.session.bearer });
  const slot = (keyId: string) => JSON.stringify([sessionId, keyId]);
  const persona = /^board:([a-z]+)$/.exec(o.session.persona)?.[1];
  const live = () => {
    const current = o.currentSession();
    return (
      o.vaultKind === "demo" &&
      o.session.role === "board" &&
      persona !== undefined &&
      current !== null &&
      current.kind === o.session.kind &&
      current.bearer === o.session.bearer &&
      current.role === o.session.role &&
      pairingId(current) === pairing &&
      sessionValid(current, new Date())
    );
  };

  return {
    serverKeyId: (keyId) => (live() ? (o.registry.get(slot(keyId))?.serverKeyId ?? null) : null),
    isRegistered: (keyId) => live() && o.registry.has(slot(keyId)),
    async register(key) {
      if (!live() || !o.api.registerFrameKey) return forbidden;
      const statement = utf8ToBytes(
        jcs({
          v: 1,
          purpose: "fs.register-demo-key",
          ws: o.session.workspaceId,
          approverId: o.session.persona,
          publicKeyHex: key.publicKeyHex,
        }),
      );
      const proof = await o.sign(statement);
      if (!live()) return forbidden;
      if (!proof.ok) return invalidSignature;
      if (proof.key.keyId !== key.keyId || proof.key.publicKeyHex !== key.publicKeyHex)
        return invalidSignature;
      try {
        if (!ed25519.verify(hexToBytes(proof.signatureHex), statement, hexToBytes(key.publicKeyHex))) {
          return invalidSignature;
        }
      } catch {
        return invalidSignature;
      }
      const result = await o.api.registerFrameKey({
        publicKeyHex: key.publicKeyHex,
        signatureHex: proof.signatureHex,
      });
      if (!live()) return forbidden;
      if (!result.ok) return result;
      const registered = result.value;
      if (
        registered.publicKeyHex !== key.publicKeyHex ||
        registered.approverId !== o.session.persona ||
        registered.kind !== "web_demo" ||
        !new RegExp(`^fs-${persona}-demo-[a-z0-9]{6}$`).test(registered.keyId)
      )
        return forbidden;
      o.registry.set(slot(key.keyId), { serverKeyId: registered.keyId, publicKeyHex: key.publicKeyHex });
      return { ok: true, value: { ok: true } };
    },
    async submit(body) {
      if (!live()) return forbidden;
      const registered = o.registry.get(slot(body.keyId));
      if (!registered) return { ok: false, code: "KEY_NOT_REGISTERED" };
      if (body.payload.approverId !== o.session.persona || !verifyApproval(body, registered.publicKeyHex)) {
        return invalidSignature;
      }
      return o.api.postApproval(o.runSlug, { ...body, keyId: registered.serverKeyId });
    },
  };
}
