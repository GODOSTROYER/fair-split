/**
 * TEMPORARY SHIM: replace with @fairsplit/domain after WS-CORE merges.
 *
 * IC-02 `batchDigest(run, items)`. Register §8 defines batchSha256 as the sha256 of
 * JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId:
 * [{senderItemId, receiver, amountCents, currency}]}. The function is injected; this package
 * never computes the digest itself, it only compares.
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
