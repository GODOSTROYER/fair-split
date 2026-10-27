/**
 * TEMPORARY SHIM: replace with @fairsplit/domain after WS-CORE merges.
 *
 * IC-02 `batchDigest(run, items)`. Register §8 defines batchSha256 as the sha256 of
 * JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId:
 * [{senderItemId, receiver, amountCents, currency}]}. The function is injected; this package
 * never computes the digest itself, it only compares. (WS-CORE's draft returns a BatchDigest object
 * over number cents; the swap is `(run, items) => batchDigest(run, toNumberCents(items)).batchSha256`.)
 *
 * IC-02 `linesDigest(lines)` (the approved plan's amendment to register §8): the sha256 of
 * JCS([{memberNo, lineSha256}] sorted by memberNo) over every member line of the run, on and off
 * rail. Injected the same way; WS-CORE's `linesDigest` has exactly this signature.
 *
 * IC-02 `requiresChair(input, cosign)` (R5 of the ratified card), mirrored from WS-CORE's draft so the
 * service can tell, from database facts alone, whether the Chair must have co-signed (I6).
 */

export interface BatchDigestRun {
  runId: string;
  senderBatchId: string;
  rateCardSha256: string;
}

export interface PayoutItemSpec {
  senderItemId: string;
  receiver: string;
  amountCents: bigint;
  currency: "USD";
}

/** Returns the lowercase hex sha256. Pure; may be sync or async. */
export type BatchDigestFn = (
  run: BatchDigestRun,
  items: readonly PayoutItemSpec[],
) => string | Promise<string>;

/** One member line of the run, on or off rail, as its stored hash. */
export interface MemberLineHash {
  memberNo: string;
  /** The line's lineSha256 as the database holds it: 64 lowercase hex characters. */
  lineSha256: string;
}

/**
 * Returns the lowercase hex sha256 of the run's lines root. Pure; may be sync or async. Throws a
 * RangeError for no lines or a member listed twice (the service never passes either).
 */
export type LinesDigestFn = (lines: readonly MemberLineHash[]) => string | Promise<string>;

/** R5 of the ratified rate card: the Chair co-signs any batch over US$300, any line over US$150, any override. */
export interface CosignRule {
  ruleId: "R5";
  batchOverCents: number;
  lineOverCents: number;
  anyOverride: boolean;
}

export type CosignReason = "BATCH_OVER_THRESHOLD" | "LINE_OVER_THRESHOLD" | "OVERRIDE";

export interface CosignInput {
  batchTotalCents: number;
  lineAmountsCents: readonly number[];
  overrides: number;
}

export function requiresChair(
  input: CosignInput,
  cosign: Pick<CosignRule, "batchOverCents" | "lineOverCents" | "anyOverride">,
): { required: boolean; reasons: CosignReason[] } {
  const reasons: CosignReason[] = [];
  if (input.batchTotalCents > cosign.batchOverCents) reasons.push("BATCH_OVER_THRESHOLD");
  if (input.lineAmountsCents.some((a) => a > cosign.lineOverCents)) reasons.push("LINE_OVER_THRESHOLD");
  if (cosign.anyOverride && input.overrides > 0) reasons.push("OVERRIDE");
  return { required: reasons.length > 0, reasons };
}
