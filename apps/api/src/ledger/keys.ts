// The server's ledger signing key (S3.12, contracts `LedgerKey`): it signs the checkpoint that anchors every
// Proof bundle's hash chain. One definition for the signer (proof bundles) and the publisher
// (/.well-known/fairsplit-keys.json), so the two can never disagree.
//
//   FS_LEDGER_SIGNING_KEY set   → `fs-ledger-k1`, kind "server": a Proof it signs can read "Verified".
//   FS_LEDGER_SIGNING_KEY unset → `fs-ledger-s2`, kind "seeded": a SAMPLE key derived (HKDF) from the cookie root,
//                                 so it is stable across restarts when FS_COOKIE_SECRET is set and ephemeral
//                                 otherwise. A checkpoint it signs reads "Sample", never "Verified" (I8).
//
// The seed's own sample ledger key (`fs-ledger-s1`, derived from public text) is published beside it, so the
// seeded showcase bundle verifies as a Sample against this server's keys too. The private half never leaves
// this module and is never logged.
import type { KeyObject } from "node:crypto";
import { type LedgerKey, LedgerKeyId } from "@fairsplit/contracts";
import { ed25519FromSeed } from "@fairsplit/domain";
import { getPublishedKeys } from "@fairsplit/seed";
import type { CredentialKeys } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";

export const SERVER_LEDGER_KEY_ID = "fs-ledger-k1" as const;
export const SAMPLE_LEDGER_KEY_ID = "fs-ledger-s2" as const;
/** HKDF purpose of the sample key (one subkey per use, see credentials/verify/keys.ts). */
export const SAMPLE_LEDGER_PURPOSE = "ledger:sample-checkpoint-key" as const;

export interface LedgerSigningKey {
  readonly keyId: string;
  readonly kind: "server" | "seeded";
  readonly publicKeyHex: string;
  readonly privateKey: KeyObject;
  /**
   * `configured`: FS_LEDGER_SIGNING_KEY. `derived_sample`: a sample key derived from FS_COOKIE_SECRET (stable).
   * `ephemeral_sample`: a sample key derived from this process's random cookie root (changes on restart).
   */
  readonly source: "configured" | "derived_sample" | "ephemeral_sample";
}

interface KeySource {
  ledgerSigningKey: string | undefined;
  credentialKeys: Pick<CredentialKeys, "hmacKey" | "ephemeral">;
}

const cache = new WeakMap<object, { seed: string | undefined; key: LedgerSigningKey }>();

/** The key that signs this server's checkpoints (memoised per credential key set, i.e. per app). */
export function ledgerSigningKey(src: KeySource): LedgerSigningKey {
  const memo = cache.get(src.credentialKeys);
  if (memo && memo.seed === src.ledgerSigningKey) return memo.key;
  let key: LedgerSigningKey;
  if (src.ledgerSigningKey !== undefined) {
    const pair = ed25519FromSeed(src.ledgerSigningKey);
    key = {
      keyId: SERVER_LEDGER_KEY_ID,
      kind: "server",
      publicKeyHex: pair.publicKeyHex,
      privateKey: pair.privateKey,
      source: "configured",
    };
  } else {
    const seed = src.credentialKeys.hmacKey(SAMPLE_LEDGER_PURPOSE).toString("hex");
    const pair = ed25519FromSeed(seed);
    key = {
      keyId: SAMPLE_LEDGER_KEY_ID,
      kind: "seeded",
      publicKeyHex: pair.publicKeyHex,
      privateKey: pair.privateKey,
      source: src.credentialKeys.ephemeral.cookie ? "ephemeral_sample" : "derived_sample",
    };
  }
  cache.set(src.credentialKeys, { seed: src.ledgerSigningKey, key });
  return key;
}

/** This app's checkpoint key, from its env and credential keys. */
export function ledgerKeyOf(deps: Pick<AppDeps, "env" | "credentials">): LedgerSigningKey {
  return ledgerSigningKey({
    ledgerSigningKey: deps.env.secrets.ledgerSigningKey,
    credentialKeys: deps.credentials.keys,
  });
}

/** The ledger keys a verifier pins: this server's key, then the seed's sample key(s). Never a private half. */
export function publishedLedgerKeys(key: LedgerSigningKey): LedgerKey[] {
  const out: LedgerKey[] = [
    { keyId: key.keyId, publicKeyHex: key.publicKeyHex, kind: key.kind, revokedAt: null },
  ];
  for (const k of getPublishedKeys().ledger) {
    if (out.some((o) => o.keyId === k.keyId)) continue;
    out.push({ keyId: k.keyId, publicKeyHex: k.publicKeyHex, kind: k.kind, revokedAt: k.revokedAt });
  }
  for (const k of out) LedgerKeyId.parse(k.keyId);
  return out;
}

/** For /ops: what signs checkpoints here, without any key material beyond the public half. */
export function describeLedgerKey(key: LedgerSigningKey): {
  keyId: string;
  kind: "server" | "seeded";
  publicKeyHex: string;
  source: LedgerSigningKey["source"];
  proofReads: "Verified" | "Sample";
} {
  return {
    keyId: key.keyId,
    kind: key.kind,
    publicKeyHex: key.publicKeyHex,
    source: key.source,
    proofReads: key.kind === "server" ? "Verified" : "Sample",
  };
}
