/**
 * The member's status capsule (M-MB-01) from the line state and the payout item's status. Item updates arrive as
 * `item.updated` over SSE (C-05) and only ever move forward (invariant I5); a repeated delivery changes nothing
 * and makes no sound (MM-6 "Delivery repeated, already applied").
 */
import type { ItemStatus, ItemUpdatedPayload, LineState, MemberStatus, RunEvent } from "../_shims/contracts";
import { fsm } from "../_shims/domain";

/** `data-state` values of M-MB-01 (S1.8). */
export type CapsuleState =
  | "checking"
  | "held-line"
  | "sent"
  | "paid"
  | "cash-due"
  | "cash-received"
  | "unclaimed"
  | "returned"
  | "paypal-held"
  | "needs-action"
  | "reversed"
  | "excluded";

export interface ItemTrack {
  status: ItemStatus | null;
  updatedAt: string | null;
  /** Evidence from the last applied item event; a session's rail cannot override it. */
  provenance?: RunEvent["provenance"];
  /** Recently applied event ids, newest last (bounded). */
  seen: readonly string[];
}

export const EMPTY_TRACK: ItemTrack = { status: null, updatedAt: null, seen: [] };
const SEEN_LIMIT = 64;

export type ItemEffect = "applied" | "duplicate" | "stale" | "other-item";

export function reduceItemEvent(
  track: ItemTrack,
  ev: RunEvent<"item.updated", ItemUpdatedPayload>,
  senderItemId: string,
  opts: { ownCancel?: boolean } = {},
): { track: ItemTrack; effect: ItemEffect } {
  if (ev.payload.senderItemId !== senderItemId) return { track, effect: "other-item" };
  if (track.seen.includes(ev.id)) return { track, effect: "duplicate" };
  const seen = [...track.seen, ev.id].slice(-SEEN_LIMIT);
  const next = fsm.item.apply(track.status, ev.payload.status, opts);
  if (next === null) return { track: { ...track, seen }, effect: "stale" };
  return { track: { status: next, updatedAt: ev.at, provenance: ev.provenance, seen }, effect: "applied" };
}

/** Replayed statuses are readable evidence, never a fresh payment confirmation or MM-1 trigger. */
export function confirmedPayment(track: ItemTrack): boolean {
  return track.status === "SUCCESS" && track.provenance !== "replay";
}

export function capsuleFor(line: {
  lineState: LineState;
  rail: "PAYPAL" | "CASH";
  itemStatus: ItemStatus | null;
}): CapsuleState {
  const { lineState, itemStatus } = line;
  if (itemStatus) {
    switch (itemStatus) {
      case "SUCCESS":
        return "paid";
      case "PENDING":
        return "sent";
      case "ONHOLD":
        return "paypal-held";
      case "UNCLAIMED":
        return "unclaimed";
      case "RETURNED":
        return lineState === "OFF_RAIL_DUE"
          ? "cash-due"
          : lineState === "OFF_RAIL_PAID"
            ? "cash-received"
            : "returned";
      case "FAILED":
      case "BLOCKED":
        return "needs-action";
      case "REFUNDED":
      case "REVERSED":
        return "reversed";
    }
  }
  switch (lineState) {
    case "HELD":
      return "held-line";
    case "EXCLUDED":
      return "excluded";
    case "OFF_RAIL_DUE":
      return "cash-due";
    case "OFF_RAIL_PAID":
      return "cash-received";
    case "LOCKED":
    case "SUBMITTED":
    case "PAYPAL_PENDING":
    case "REROUTED":
      return "sent";
    case "PAID":
      return "paid";
    case "UNCLAIMED":
      return "unclaimed";
    case "RETURNED":
      return "returned";
    case "PAYPAL_HELD":
      return "paypal-held";
    case "NEEDS_ACTION":
      return "needs-action";
    case "REVERSED":
      return "reversed";
    default:
      return "checking";
  }
}

/** The register's member status word for a capsule state (never a raw state name). */
export const CAPSULE_WORD: Readonly<Record<CapsuleState, MemberStatus>> = {
  checking: "HELD",
  "held-line": "HELD",
  sent: "PAYPAL_PENDING",
  paid: "PAID",
  "cash-due": "OFF_RAIL_DUE",
  "cash-received": "OFF_RAIL_PAID",
  unclaimed: "UNCLAIMED",
  returned: "RETURNED",
  "paypal-held": "PAYPAL_HELD",
  "needs-action": "NEEDS_ACTION",
  reversed: "REVERSED",
  excluded: "EXCLUDED",
};

/** Amounts stay hollow until they are in the member's hands (design §2.5 "Hollow"). */
export function amountIsSolid(state: CapsuleState): boolean {
  return state === "paid" || state === "cash-received";
}

/** The pending ring animates for at most 60 s, then shows elapsed time only (design §3 rule 2). */
export const PENDING_RING_MAX_MS = 60_000;

/**
 * One job per colour (design §2.2): `landed` is jade flush (PayPal confirmed), `decide` canary (a person must
 * decide; never an error, and UNCLAIMED is "Parked", never red), `failure` red (only a PayPal failure), `cash` hatch
 * with a word, `pending` graphite (sent, waiting for PayPal), `neutral` for the rest.
 */
export type StatusTone = "landed" | "decide" | "failure" | "cash" | "pending" | "neutral";

export const STATUS_TONE: Readonly<Record<MemberStatus, StatusTone>> = {
  HELD: "decide",
  EXCLUDED: "neutral",
  PAYPAL_PENDING: "pending",
  PAID: "landed",
  OFF_RAIL_DUE: "cash",
  OFF_RAIL_PAID: "cash",
  UNCLAIMED: "decide",
  RETURNED: "neutral",
  REROUTED: "pending",
  PAYPAL_HELD: "decide",
  NEEDS_ACTION: "failure",
  REVERSED: "failure",
};

/** Every status also carries a glyph, so no state is told by colour alone (names from ui/glyph). */
export const STATUS_GLYPH: Readonly<
  Record<MemberStatus, "scale" | "info" | "clock" | "check" | "cash" | "refresh" | "lock" | "close">
> = {
  HELD: "scale",
  EXCLUDED: "info",
  PAYPAL_PENDING: "clock",
  PAID: "check",
  OFF_RAIL_DUE: "cash",
  OFF_RAIL_PAID: "check",
  UNCLAIMED: "info",
  RETURNED: "refresh",
  REROUTED: "refresh",
  PAYPAL_HELD: "lock",
  NEEDS_ACTION: "close",
  REVERSED: "refresh",
};
