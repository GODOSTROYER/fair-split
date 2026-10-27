// toItemStatus() and the forward-only rule for payout item statuses (register §7, S3.5).
//
// - Event names map to statuses before ranking: SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED;
//   the other item events (UNCLAIMED, FAILED, RETURNED, BLOCKED, REFUNDED) keep their names.
// - A status is applied only if its rank is higher than the current one, so arrival order does not
//   matter (inv.i5.forward-only).
// - RETURNED is accepted only after our own cancel (`cancel_requested_at`); otherwise the event is
//   stored and the run goes to NEEDS_FOLLOW_UP.

import { ITEM_STATUSES, type ItemStatus } from "./_shims/contracts.js";
import { ITEM_STATUS_RANK } from "./_shims/domain.js";

export { ITEM_STATUS_RANK, ITEM_STATUSES, type ItemStatus };

const ITEM_EVENT_PREFIX = "PAYMENT.PAYOUTS-ITEM.";

/** PAYMENT.PAYOUTS-ITEM.<name> → status. Only the eight item events we subscribe to (register §8). */
const ITEM_EVENT_STATUS: Readonly<Record<string, ItemStatus>> = Object.freeze({
  SUCCEEDED: "SUCCESS",
  UNCLAIMED: "UNCLAIMED",
  FAILED: "FAILED",
  RETURNED: "RETURNED",
  CANCELED: "RETURNED",
  BLOCKED: "BLOCKED",
  HELD: "ONHOLD",
  REFUNDED: "REFUNDED",
});

/** Map a PAYMENT.PAYOUTS-ITEM.* event type to an item status; null for anything else. */
export function toItemStatus(eventType: string): ItemStatus | null {
  if (!eventType.startsWith(ITEM_EVENT_PREFIX)) return null;
  const name = eventType.slice(ITEM_EVENT_PREFIX.length);
  return Object.hasOwn(ITEM_EVENT_STATUS, name) ? (ITEM_EVENT_STATUS[name] ?? null) : null;
}

const STATUS_SET: ReadonlySet<string> = new Set(ITEM_STATUSES);

/** Validate a `transaction_status` value from a payout item GET. */
export function parseItemStatus(value: unknown): ItemStatus | null {
  return typeof value === "string" && STATUS_SET.has(value) ? (value as ItemStatus) : null;
}

export function itemStatusRank(status: ItemStatus | null): number {
  return status === null ? 0 : ITEM_STATUS_RANK[status];
}

export type ItemStatusDecision =
  | { apply: true; status: ItemStatus; rank: number }
  | {
      apply: false;
      reason: "NOT_HIGHER" | "RETURNED_WITHOUT_CANCEL";
      /** True when the event must be kept and the run moved to NEEDS_FOLLOW_UP. */
      followUp: boolean;
    };

/**
 * Decide whether `next` may replace `current` (null = no status yet, rank 0).
 * `cancelRequested` is true once we have asked PayPal to cancel this item (`cancel_requested_at`).
 */
export function decideItemStatus(
  current: ItemStatus | null,
  next: ItemStatus,
  context: { cancelRequested: boolean },
): ItemStatusDecision {
  if (itemStatusRank(next) <= itemStatusRank(current))
    return { apply: false, reason: "NOT_HIGHER", followUp: false };
  if (next === "RETURNED" && !context.cancelRequested) {
    return { apply: false, reason: "RETURNED_WITHOUT_CANCEL", followUp: true };
  }
  return { apply: true, status: next, rank: ITEM_STATUS_RANK[next] };
}
