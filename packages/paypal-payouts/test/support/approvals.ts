// Real Ed25519 approvals for tests (node:crypto, no extra dependency). Each signer stands for a
// registered `device_keys` row; `registeredKeyVerifier` checks a signature against that row, never
// against the approval's own publicKeyHex, as the injected production verifier must.

import { generateKeyPairSync, type KeyObject, randomBytes, sign, verify } from "node:crypto";
import canonicalize from "canonicalize";
import type { ApprovalPayload, ApprovalRole, SignedApproval } from "../../src/index.js";

export interface TestSigner {
  role: ApprovalRole;
  approverId: string;
  keyId: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicKeyHex: string;
}

export function makeSigner(role: ApprovalRole, approverId: string, keyId: string): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return { role, approverId, keyId, publicKey, privateKey, publicKeyHex: der.subarray(-32).toString("hex") };
}

/** Analyn signs as treasurer; Ernesto co-signs as Chair (register §2). */
export const TREASURER = makeSigner("treasurer", "treasurer:analyn", "fs-analyn-w1");
export const CHAIR = makeSigner("chair", "board:ernesto", "fs-ernesto-a1");
/** A key nobody registered. */
export const STRANGER = makeSigner("treasurer", "treasurer:analyn", "fs-mallory-w9");

function jcsBytes(payload: ApprovalPayload): Buffer {
  const text = canonicalize(payload);
  if (text === undefined) throw new Error("payload is not canonicalizable");
  return Buffer.from(text, "utf8");
}

export function signPayload(signer: TestSigner, payload: ApprovalPayload): SignedApproval {
  return {
    role: payload.role,
    keyId: signer.keyId,
    publicKeyHex: signer.publicKeyHex,
    payload,
    signatureHex: sign(null, jcsBytes(payload), signer.privateKey).toString("hex"),
  };
}

export interface BatchFacts {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batchSha256: string;
  itemCount: number;
  totalCents: number;
}

/** The register §8 payload for one signer, signed. */
export function approve(
  signer: TestSigner,
  batch: BatchFacts,
  options: { exp: string; nonce?: string; payload?: Partial<ApprovalPayload> },
): SignedApproval {
  return signPayload(signer, {
    v: 1,
    runId: batch.runId,
    seasonId: batch.seasonId,
    rateCardSha256: batch.rateCardSha256,
    batchSha256: batch.batchSha256,
    itemCount: batch.itemCount,
    totalCents: batch.totalCents,
    currency: "USD",
    role: signer.role,
    approverId: signer.approverId,
    nonce: options.nonce ?? randomBytes(12).toString("hex"),
    exp: options.exp,
    ...options.payload,
  });
}

/** The production contract: verify against the registered row only. */
export function registeredKeyVerifier(registered: readonly TestSigner[] = [TREASURER, CHAIR]) {
  const byKeyId = new Map(registered.map((s) => [s.keyId, s]));
  return async (approval: SignedApproval): Promise<boolean> => {
    const row = byKeyId.get(approval.keyId);
    if (!row || row.approverId !== approval.payload.approverId || row.role !== approval.role) return false;
    return verify(null, jcsBytes(approval.payload), row.publicKey, Buffer.from(approval.signatureHex, "hex"));
  };
}
