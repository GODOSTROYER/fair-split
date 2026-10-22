// I6: a person approves the irreversible step. Each approver signs the register §8 JCS payload
// {v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents, currency, role,
// approverId, nonce, exp} with Ed25519. The Chair co-signs a batch over US$300, a line over US$150
// and any override (R5).
import {
  ApprovalPayload,
  type ApprovalRole,
  type BatchDigest,
  type CosignReason,
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

export type ApprovalCheck =
  | { ok: true }
  | {
      ok: false;
      code: "DIGEST_MISMATCH" | "SIGNATURE_INVALID" | "APPROVAL_EXPIRED" | "NONCE_REUSED";
      reason: string;
    };

export interface ApprovalExpectation {
  runId: string;
  rateCardSha256: string;
  batchSha256: string;
  itemCount: number;
  totalCents: number;
  role: ApprovalRole;
}

/**
 * Server-side check of a submitted approval: the payload must match the recomputed batch, the
 * signature must verify against the registered key, `exp` must be in the future and at most
 * 30 minutes away, and the nonce must be unused.
 */
export function checkApproval(
  signed: SignedApproval,
  expected: ApprovalExpectation,
  now: Date,
  usedNonces: ReadonlySet<string> = new Set(),
): ApprovalCheck {
  const p = signed.payload;
  if (
    p.runId !== expected.runId ||
    p.rateCardSha256 !== expected.rateCardSha256 ||
    p.batchSha256 !== expected.batchSha256 ||
    p.itemCount !== expected.itemCount ||
    p.totalCents !== expected.totalCents ||
    p.role !== expected.role ||
    signed.role !== expected.role
  ) {
    return {
      ok: false,
      code: "DIGEST_MISMATCH",
      reason: "The batch changed after it was signed. Nothing was sent.",
    };
  }
  const exp = Date.parse(p.exp);
  if (Number.isNaN(exp) || exp <= now.getTime() || exp - now.getTime() > APPROVAL_MAX_TTL_MS) {
    return { ok: false, code: "APPROVAL_EXPIRED", reason: "The co-sign request expired. Send again." };
  }
  if (usedNonces.has(p.nonce))
    return { ok: false, code: "NONCE_REUSED", reason: "This approval was already used." };
  if (!ed25519Verify(signed.publicKeyHex, approvalBytes(p), signed.signatureHex)) {
    return { ok: false, code: "SIGNATURE_INVALID", reason: "The signature does not verify." };
  }
  return { ok: true };
}

/** Signature check alone (Proof plate 5 uses it with no clock). */
export function approvalSignatureValid(signed: SignedApproval): boolean {
  return ed25519Verify(signed.publicKeyHex, approvalBytes(signed.payload), signed.signatureHex);
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
