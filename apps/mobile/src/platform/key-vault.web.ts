/**
 * Web frames (C-13): the browser makes an ephemeral Ed25519 key for each judge session, named
 * `fs-ernesto-demo-{6}` and labelled "Demo key (this browser)". It lives in memory only and is gone with the tab.
 * The hold on the Pirmahi slab is the presence step; there is no biometric on the web.
 */
import { createSoftwareSigner, demoKeyId, type Signer } from "../lib/signing";
import type { KeyMeta, KeyVault } from "./key-vault";
import { randomBytes } from "./random";

export type { BiometricClass, KeyMeta, KeyVault } from "./key-vault";

let session: { meta: KeyMeta; signer: Signer } | null = null;

export const keyVault: KeyVault = {
  kind: "demo",
  async current() {
    return session?.meta ?? null;
  },
  async ensureKey(persona) {
    if (session) return session.meta;
    const keyId = demoKeyId(persona, randomBytes);
    const signer = createSoftwareSigner({ keyId, kind: "demo", randomBytes });
    session = {
      signer,
      meta: {
        keyId,
        publicKeyHex: await signer.publicKeyHex(),
        biometricClass: "none",
        createdAt: new Date().toISOString(),
      },
    };
    return session.meta;
  },
  signer(meta) {
    if (!session || session.meta.keyId !== meta.keyId) throw new Error("Demo key belongs to another session");
    return session.signer;
  },
  async forget() {
    session = null;
  },
};
