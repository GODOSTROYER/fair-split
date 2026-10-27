/**
 * TEMPORARY SHIM: replace with @fairsplit/contracts after WS-CORE merges.
 *
 * Register §8 "Signed payload" and the IC-01 Actor, with the names and shapes of WS-CORE's draft
 * (`packages/contracts/src/domain.ts` and `entities.ts` on ws/core, not yet frozen), written as plain
 * types because this package is zod 3. Register §8, as the approved plan amends it (00-plan.md,
 * "Signed payload"): each approver signs JCS{v, runId, seasonId, rateCardSha256, batchSha256,
 * linesDigest, itemCount, totalCents, currency, role, approverId, nonce, exp} with Ed25519.
 */

export type ApprovalRole = "treasurer" | "chair";

export interface ApprovalPayload {
  v: 1;
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  /** Binds the PayPal items (IC-02 `batchDigest`). */
  batchSha256: string;
  /**
   * Binds every member line of the run, on and off rail, so both keys cover the cash lines too:
   * IC-02 `linesDigest`, sha256(JCS([{memberNo, lineSha256}] sorted by memberNo)).
   */
  linesDigest: string;
  itemCount: number;
  /** Integer US cents (JCS has no bigint). */
  totalCents: number;
  currency: "USD";
  role: ApprovalRole;
  approverId: string;
  nonce: string;
  /** ISO-8601 date-time; at most 30 minutes after signing (S3.8). */
  exp: string;
}

export interface SignedApproval {
  role: ApprovalRole;
  /** `fs-{persona}-{a|w}{n}` (S3.8). */
  keyId: string;
  /** As presented; never a trust anchor (the registered `device_keys` row is). */
  publicKeyHex: string;
  payload: ApprovalPayload;
  /** 64-byte Ed25519 signature over the payload's JCS bytes, hex. */
  signatureHex: string;
}

export type ActorKind = "human" | "agent" | "engine" | "paypal" | "system";

/** Carried by every run event and ledger entry. */
export interface Actor {
  kind: ActorKind;
  id: string;
  impersonatedBy: string | null;
}
