// I6: a person approves the irreversible step. Each approver signs the register §8 JCS payload, as
// amended by the approved plan, {v, runId, seasonId, rateCardSha256, batchSha256, linesDigest,
// itemCount, totalCents, currency, role, approverId, nonce, exp} with Ed25519: `batchSha256` binds the
// PayPal items and `linesDigest` every member line, the cash lines too. The Chair co-signs a batch over
// US$300, a line over US$150 and any override (R5).
//
// Trust comes only from the officer key registry (`device_keys`), which the server reads for the
// role being signed. A key presented with an approval is compared against the registry's key for
// that role and refused as an unknown signer before any signature is checked; the signature is
// then verified with the registry's key, never the presented one.
import {
  ApprovalPayload,
  type ApprovalRole,
  type BatchDigest,
  type CosignReason,
  isSeededKeyId,
  type OfficerKey,
  type RateCardRules,
  type SignedApproval,
} from "@fairsplit/contracts";
import { sha256Hex } from "./canon.js";
import { approvalBytes, linesRootJcs } from "./digest-input.js";
import { jcs } from "./jcs.js";
import { ed25519Verify } from "./sig.js";

export { approvalBytes } from "./digest-input.js";

export const APPROVAL_MAX_TTL_MS = 30 * 60 * 1000;

/**
 * The `linesDigest` both approvers sign: the lines root over every member line of the run, on and off
 * rail, sha256(JCS([{memberNo, lineSha256}] sorted by memberNo)). It is the root the run's
 * `lines.computed` ledger entry carries and Proof plate 4 recomputes, so a cash line changed after
 * signing no longer matches either key. One line per member; at least one line.
 */
export function linesDigest(lines: readonly { memberNo: string; lineSha256: string }[]): string {
  if (lines.length === 0) throw new RangeError("linesDigest needs the run's lines");
  if (new Set(lines.map((l) => l.memberNo)).size !== lines.length) {
    throw new RangeError("linesDigest needs one line per member");
  }
  return sha256Hex(linesRootJcs(lines));
}

export interface ApprovalInput {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batch: Pick<BatchDigest, "batchSha256" | "itemCount" | "totalCents">;
  /** `linesDigest(lines)` over every member line of the run, recomputed from the database. */
  linesDigest: string;
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
    linesDigest: input.linesDigest,
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
  | "SIGNERS_NOT_DISTINCT"
  | "APPROVALS_MISSING"
  | "SEASON_MISMATCH"
  | "DIGEST_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "NONCE_REUSED"
  | "SIGNATURE_INVALID";

export type ApprovalCheck = { ok: true } | { ok: false; code: ApprovalCheckCode; reason: string };

const refuse = (code: ApprovalCheckCode, reason: string): ApprovalCheck => ({ ok: false, code, reason });

const SEEDED_NEVER_SIGN = "Seeded sample keys never sign.";
const ROLE_NOUN: Readonly<Record<ApprovalRole, string>> = { treasurer: "treasurer", chair: "Chair" };

/**
 * The signer the server expects for one role: the registry's key, read server-side from
 * `device_keys` for that role (never from the request).
 */
export interface ExpectedSigner {
  keyId: string;
  publicKeyHex: string;
  /** The persona the key belongs to, e.g. "board:ernesto": the payload's `approverId`. */
  approverId: string;
  revokedAt?: string | null;
}

export interface ApprovalExpectation extends ExpectedSigner {
  runId: string;
  seasonId: string;
  rateCardSha256: string;
  batchSha256: string;
  /** `linesDigest(lines)` recomputed from the database's lines for the run (I4). */
  linesDigest: string;
  itemCount: number;
  totalCents: number;
  role: ApprovalRole;
}

export type SignerLookup =
  | { ok: true; signer: ExpectedSigner }
  | { ok: false; code: "KEY_NOT_REGISTERED"; reason: string };

const revokedBy = (revokedAt: string | null | undefined, now: Date): boolean => {
  if (revokedAt === null || revokedAt === undefined) return false;
  const t = Date.parse(revokedAt);
  // An unreadable revocation time counts as revoked: fail closed.
  return Number.isNaN(t) || t <= now.getTime();
};

/**
 * Looks up who may sign for `role` in the officer key registry (`device_keys` joined with the
 * officer's role), as the server read it. The presented key ID only selects among the keys the
 * registry holds for that role; the public key and approver come from the registry. A key the
 * registry does not list for this role, a revoked key, a seeded key and an ambiguous registry are
 * all refused as unknown signers.
 */
export function expectedSigner(
  registry: readonly OfficerKey[],
  role: ApprovalRole,
  keyId: string,
  now: Date,
): SignerLookup {
  const unknown = (reason: string): SignerLookup => ({ ok: false, code: "KEY_NOT_REGISTERED", reason });
  const rows = registry.filter((k) => k.keyId === keyId);
  const row = rows[0];
  if (!row) return unknown(`Unknown signer: ${keyId} is not a registered officer key.`);
  if (rows.length > 1) return unknown(`Unknown signer: the key registry lists ${keyId} more than once.`);
  if (isSeededKeyId(row.keyId) || row.kind === "seeded") return unknown(SEEDED_NEVER_SIGN);
  if (row.role !== role) {
    return unknown(`Unknown signer: ${keyId} is not registered to sign for the ${ROLE_NOUN[role]}.`);
  }
  if (revokedBy(row.revokedAt, now)) return unknown(`Unknown signer: ${keyId} was revoked.`);
  return {
    ok: true,
    signer: {
      keyId: row.keyId,
      publicKeyHex: row.publicKeyHex,
      approverId: row.approverId,
      revokedAt: row.revokedAt,
    },
  };
}

function requireNonceStore(usedNonces: unknown): asserts usedNonces is ReadonlySet<string> {
  if (
    usedNonces === null ||
    typeof usedNonces !== "object" ||
    typeof (usedNonces as { has?: unknown }).has !== "function"
  ) {
    throw new TypeError("usedNonces is required: pass the run's spent approval nonces.");
  }
}

/**
 * Server-side check of one submitted approval (I6). In order: the signer must be exactly the
 * expected registry key for the role (else "Unknown signer", before any signature is checked; never
 * a seeded or revoked key); the payload must name that approver, role and season and match the
 * recomputed batch and the recomputed lines digest; `exp` must be in the future and at most 30
 * minutes away; the nonce must not be in `usedNonces`; and the signature must verify against
 * `expected.publicKeyHex`.
 */
export function checkApproval(
  signed: SignedApproval,
  expected: ApprovalExpectation,
  now: Date,
  usedNonces: ReadonlySet<string>,
): ApprovalCheck {
  requireNonceStore(usedNonces);
  const p = signed.payload;
  if (isSeededKeyId(signed.keyId) || isSeededKeyId(expected.keyId)) {
    return refuse("KEY_NOT_REGISTERED", SEEDED_NEVER_SIGN);
  }
  if (revokedBy(expected.revokedAt, now)) {
    return refuse("KEY_NOT_REGISTERED", `Unknown signer: ${expected.keyId} was revoked.`);
  }
  if (signed.keyId !== expected.keyId || signed.publicKeyHex !== expected.publicKeyHex) {
    return refuse(
      "KEY_NOT_REGISTERED",
      `Unknown signer: this is not the registered key for the ${ROLE_NOUN[expected.role]}.`,
    );
  }
  if (signed.role !== expected.role || p.role !== expected.role) {
    return refuse("APPROVER_MISMATCH", "This approval was signed for another role.");
  }
  if (p.approverId !== expected.approverId) {
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
    p.currency !== "USD"
  ) {
    return refuse("DIGEST_MISMATCH", "The batch changed after it was signed. Nothing was sent.");
  }
  if (p.linesDigest !== expected.linesDigest) {
    return refuse("DIGEST_MISMATCH", "A line changed after it was signed. Nothing was sent.");
  }
  const exp = Date.parse(p.exp);
  if (Number.isNaN(exp) || exp <= now.getTime() || exp - now.getTime() > APPROVAL_MAX_TTL_MS) {
    return refuse("APPROVAL_EXPIRED", "The co-sign request expired. Send again.");
  }
  if (usedNonces.has(p.nonce)) return refuse("NONCE_REUSED", "This approval was already used.");
  if (!ed25519Verify(expected.publicKeyHex, approvalBytes(p), signed.signatureHex)) {
    return refuse("SIGNATURE_INVALID", "The signature does not verify.");
  }
  return { ok: true };
}

export interface ApprovalSet {
  /** Every approval presented for the batch (the treasurer's, and the Chair's when given). */
  approvals: readonly SignedApproval[];
  /** The server's expectation per role, each signer looked up with `expectedSigner`. */
  expected: Readonly<Partial<Record<ApprovalRole, ApprovalExpectation>>>;
  /** R5 (`requiresChair`), computed from database facts. */
  chairRequired: boolean;
}

const allDistinct = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;

/**
 * The approvals for one batch, as `PayoutsService.executeApproved` and the second signature's
 * submission check them: one approval per role; the treasurer always, the Chair when R5 needs her;
 * the treasurer and the Chair are two people with two keys (distinct key IDs, public keys and
 * approvers, presented and expected), checked before any signature; no nonce is shared or spent;
 * then every approval passes `checkApproval`.
 */
export function checkApprovals(set: ApprovalSet, now: Date, usedNonces: ReadonlySet<string>): ApprovalCheck {
  requireNonceStore(usedNonces);
  const roles = set.approvals.map((a) => a.role);
  if (!allDistinct(roles)) return refuse("SIGNERS_NOT_DISTINCT", "One role signed twice.");
  if (!roles.includes("treasurer"))
    return refuse("APPROVALS_MISSING", "The treasurer's approval is missing.");
  if (set.chairRequired && !roles.includes("chair")) {
    return refuse("APPROVALS_MISSING", "The Chair's co-signature is missing.");
  }
  const pairs: [SignedApproval, ApprovalExpectation][] = [];
  for (const a of set.approvals) {
    const e = set.expected[a.role];
    if (!e || e.role !== a.role) {
      return refuse(
        "KEY_NOT_REGISTERED",
        `Unknown signer: no key is registered for the ${ROLE_NOUN[a.role]}.`,
      );
    }
    pairs.push([a, e]);
  }
  const twoPeople = "The treasurer and the Chair must be two people with two keys.";
  const keyIds = pairs.map(([a, e]) => new Set([a.keyId, e.keyId]));
  const publicKeys = pairs.map(([a, e]) => new Set([a.publicKeyHex, e.publicKeyHex]));
  const people = pairs.map(([a, e]) => new Set([a.payload.approverId, e.approverId]));
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const overlaps = (sets: Set<string>[]) => [...(sets[i] ?? [])].some((x) => sets[j]?.has(x));
      if (overlaps(keyIds) || overlaps(publicKeys) || overlaps(people)) {
        return refuse("SIGNERS_NOT_DISTINCT", twoPeople);
      }
    }
  }
  if (!allDistinct(set.approvals.map((a) => a.payload.nonce))) {
    return refuse("NONCE_REUSED", "Each approval needs its own nonce.");
  }
  for (const [a, e] of pairs) {
    const r = checkApproval(a, e, now, usedNonces);
    if (!r.ok) return r;
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
