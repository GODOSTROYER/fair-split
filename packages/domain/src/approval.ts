// I6: a person approves the irreversible step. Each approver signs the register §8 JCS payload
// {v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents, currency, role,
// approverId, nonce, exp} with Ed25519. The Chair co-signs a batch over US$300, a line over US$150
// and any override (R5).
import {
  ApprovalPayload,
  type ApprovalRole,
  type BatchDigest,
  type CosignReason,
  isSeededKeyId,
  type RateCardRules,
  type SignedApproval,
} from "@fairsplit/contracts";
import { approvalBytes } from "./digest-input.js";
import { jcs } from "./jcs.js";
import { ed25519Verify } from "./sig.js";

export { approvalBytes } from "./digest-input.js";

export const APPROVAL_MAX_TTL_MS = 30 * 60 * 1000;

export interface ApprovalInput {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batch: Pick<BatchDigest, "batchSha256" | "itemCount" | "totalCents">;
  role: ApprovalRole;
  approverId: string;
  nonce: string;
  exp: string;
}

export function buildApprovalPayload(input: ApprovalInput): ApprovalPayload {
  return ApprovalPayload.parse({
    v: 1,
    runId: input.runId,
    seasonId: input.seasonId,
    rateCardSha256: input.rateCardSha256,
    batchSha256: input.batch.batchSha256,
    itemCount: input.batch.itemCount,
    totalCents: input.batch.totalCents,
    currency: "USD",
    role: input.role,
    approverId: input.approverId,
    nonce: input.nonce,
    exp: input.exp,
  });
}

/** The exact string an approver signs. */
export function approvalJcs(payload: ApprovalPayload): string {
  return jcs(payload);
}

export type ApprovalCheckCode =
  | "KEY_NOT_REGISTERED"
  | "APPROVER_MISMATCH"
  | "SEASON_MISMATCH"
  | "DIGEST_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "NONCE_REUSED"
  | "SIGNATURE_INVALID";

export type ApprovalCheck = { ok: true } | { ok: false; code: ApprovalCheckCode; reason: string };

/**
 * The approver's registered device key, read by the server from `device_keys` and `memberships`
 * (never from the request). Seeded keys are never registered.
 */
export interface RegisteredKey {
  keyId: string;
  publicKeyHex: string;
  /** The persona the key belongs to, e.g. "board:ernesto": the payload's `approverId`. */
  approverId: string;
  /** The role this approver may sign for. */
  role: ApprovalRole;
  revokedAt?: string | null;
}

export interface ApprovalExpectation {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batchSha256: string;
  itemCount: number;
  totalCents: number;
  role: ApprovalRole;
  registered: RegisteredKey;
}

const refuse = (code: ApprovalCheckCode, reason: string): ApprovalCheck => ({ ok: false, code, reason });

/**
 * Server-side check of a submitted approval (I6). Trust comes only from `expected.registered`: the
 * submitted `publicKeyHex` is never used to verify. In order: the key must be the approver's
 * registered, unrevoked device key (never a seeded key); the payload must name that approver, the
 * role and the season; it must match the recomputed batch; `exp` must be in the future and at most
 * 30 minutes away; the nonce must be unused; and the signature must verify against the registered key.
 */
export function checkApproval(
  signed: SignedApproval,
  expected: ApprovalExpectation,
  now: Date,
  usedNonces: ReadonlySet<string> = new Set(),
): ApprovalCheck {
  const p = signed.payload;
  const reg = expected.registered;
  if (isSeededKeyId(signed.keyId) || isSeededKeyId(reg.keyId)) {
    return refuse("KEY_NOT_REGISTERED", "Seeded sample keys never sign.");
  }
  const revoked = reg.revokedAt ? Date.parse(reg.revokedAt) <= now.getTime() : false;
  if (signed.keyId !== reg.keyId || signed.publicKeyHex !== reg.publicKeyHex || revoked) {
    return refuse("KEY_NOT_REGISTERED", "This key is not the approver's registered key.");
  }
  if (p.approverId !== reg.approverId || reg.role !== expected.role) {
    return refuse("APPROVER_MISMATCH", "This approval names a different approver.");
  }
  if (p.seasonId !== expected.seasonId) {
    return refuse("SEASON_MISMATCH", "This approval was made for another season.");
  }
  if (
    p.runId !== expected.runId ||
    p.rateCardSha256 !== expected.rateCardSha256 ||
    p.batchSha256 !== expected.batchSha256 ||
    p.itemCount !== expected.itemCount ||
    p.totalCents !== expected.totalCents ||
    p.role !== expected.role ||
    signed.role !== expected.role
  ) {
    return refuse("DIGEST_MISMATCH", "The batch changed after it was signed. Nothing was sent.");
  }
  const exp = Date.parse(p.exp);
  if (Number.isNaN(exp) || exp <= now.getTime() || exp - now.getTime() > APPROVAL_MAX_TTL_MS) {
    return refuse("APPROVAL_EXPIRED", "The co-sign request expired. Send again.");
  }
  if (usedNonces.has(p.nonce)) return refuse("NONCE_REUSED", "This approval was already used.");
  if (!ed25519Verify(reg.publicKeyHex, approvalBytes(p), signed.signatureHex)) {
    return refuse("SIGNATURE_INVALID", "The signature does not verify.");
  }
  return { ok: true };
}

/** Signature check alone, against a key the caller trusts (never the approval's own field). */
export function approvalSignatureValid(signed: SignedApproval, publicKeyHex: string): boolean {
  return ed25519Verify(publicKeyHex, approvalBytes(signed.payload), signed.signatureHex);
}

export interface CosignInput {
  batchTotalCents: number;
  lineAmountsCents: readonly number[];
  overrides: number;
}

/** R5: the Chair must co-sign any batch over US$300, any line over US$150 and any override. */
export function requiresChair(
  input: CosignInput,
  cosign: RateCardRules["cosign"],
): { required: boolean; reasons: CosignReason[] } {
  const reasons: CosignReason[] = [];
  if (input.batchTotalCents > cosign.batchOverCents) reasons.push("BATCH_OVER_THRESHOLD");
  if (input.lineAmountsCents.some((a) => a > cosign.lineOverCents)) reasons.push("LINE_OVER_THRESHOLD");
  if (cosign.anyOverride && input.overrides > 0) reasons.push("OVERRIDE");
  return { required: reasons.length > 0, reasons };
}
