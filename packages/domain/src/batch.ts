// Identifiers and the batch digest (register §8 field table). I4: the approved digest is the
// payout; PayoutsService re-hashes the batch from the DB immediately before the POST and refuses a
// mismatch.
import type { BatchDigest, BatchItem } from "@fairsplit/contracts";
import { sha256Hex } from "./canon.js";
import { type BatchRun, batchCanonical } from "./digest-input.js";
import { hashGroups } from "./format.js";
import { bpHalfUp } from "./money.js";

export { type BatchRun, invoiceReference, linesRootJcs } from "./digest-input.js";
export {
  batchNote,
  invoiceNumber,
  parseRunSlug,
  parseSenderItemId,
  runSlug,
  seasonLabelOf,
  senderBatchId,
  senderItemId,
} from "./ids.js";

/** The payer-visible memo: "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03". */
export function invoiceMemo(seasonLabel: string, rateCardSha256: string, lotCode: string): string {
  return `Season ${seasonLabel}, RC ${hashGroups(rateCardSha256, 2)}, lot ${lotCode}`;
}

/** PayPal-Request-Id = sha256(sender_batch_id). */
export function paypalRequestId(senderBatch: string): string {
  return sha256Hex(senderBatch);
}

/**
 * batchSha256 = sha256 of JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId:
 * [{senderItemId, receiver, amountCents, currency}]}. Item order on input does not matter.
 */
export function batchDigest(run: BatchRun, items: readonly BatchItem[]): BatchDigest {
  const c = batchCanonical(run, items);
  return { ...c, batchSha256: sha256Hex(c.jcs) };
}

/** I4 guard: true only when the re-hashed batch equals the signed digest. */
export function digestMatches(
  signedBatchSha256: string,
  run: BatchRun,
  items: readonly BatchItem[],
): boolean {
  return batchDigest(run, items).batchSha256 === signedBatchSha256;
}

/** Published US sandbox fee per item (US$0.25) and the production rate to the Philippines (2%). */
export const PUBLISHED_FEES = { usPerItemCents: 25, intlBp: 200, intlCapCents: 2000 } as const;

/** Published rates only (C-28): actual fees come from PayPal's `payout_item_fee`. */
export function publishedFees(
  itemCount: number,
  totalCents: number,
): { sandboxCents: number; productionCents: number } {
  const production = Math.min(
    bpHalfUp(totalCents, PUBLISHED_FEES.intlBp),
    PUBLISHED_FEES.intlCapCents * itemCount,
  );
  return { sandboxCents: PUBLISHED_FEES.usPerItemCents * itemCount, productionCents: production };
}
