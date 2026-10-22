// TEMPORARY SHIM: replace with @fairsplit/contracts|domain after WS-CORE merges.
//
// Mirrors the decision register §7 ("Payout item ranks"): the PayPal payout item statuses that
// `transaction_status` and the PAYMENT.PAYOUTS-ITEM.* webhooks can produce. Only plain data and
// types live here, so swapping the import to @fairsplit/contracts is mechanical (no zod objects
// cross the zod 3 / zod 4 boundary).

/** Payout item statuses, as PayPal reports them in `transaction_status` (register §7). */
export const ITEM_STATUSES = [
  "PENDING",
  "ONHOLD",
  "UNCLAIMED",
  "RETURNED",
  "FAILED",
  "BLOCKED",
  "SUCCESS",
  "REFUNDED",
  "REVERSED",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];
