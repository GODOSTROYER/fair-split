import type { ItemStatus, ItemUpdatedPayload, RunEvent } from "../../_shims/contracts";
import { confirmedPayment, type ItemEffect, type ItemTrack, reduceItemEvent } from "../../lib/item-status";

export { payoutStatus, railLabel, statementRail } from "../../lib/payout-status";

const STATUS: Readonly<Record<string, ItemStatus>> = {
  PENDING: "PENDING",
  PROCESSING: "PENDING",
  SUCCEEDED: "SUCCESS",
  SUCCESS: "SUCCESS",
  UNCLAIMED: "UNCLAIMED",
  RETURNED: "RETURNED",
  ONHOLD: "ONHOLD",
  HELD: "ONHOLD",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  REVERSED: "REVERSED",
};

/** fs-api only appends webhook events after verification; POST acceptance is never settlement. */
export function memberEvent(event: RunEvent): RunEvent<"item.updated", ItemUpdatedPayload> | null {
  if (event.type !== "item.updated") return null;
  const p = event.payload as {
    to?: string;
    status?: string;
    source?: string;
    eventId?: string | null;
    senderItemId?: string;
    memberNo?: string;
    payoutItemId?: string;
  };
  const status = STATUS[p.to ?? p.status ?? ""];
  if (!status || !p.senderItemId || !p.memberNo) return null;
  if (
    status === "SUCCESS" &&
    !(
      event.provenance === "replay" ||
      (event.provenance === "simulated_rail" && p.source === "webhook" && p.eventId)
    )
  )
    return null;
  if (p.source !== "webhook" && p.source !== "status_check") return null;
  return {
    ...event,
    type: "item.updated",
    payload: {
      senderItemId: p.senderItemId,
      memberNo: p.memberNo,
      status,
      source: p.source,
      payoutItemId: p.payoutItemId,
    },
  };
}

export interface PaidSignal {
  eventId: string;
  at: string;
  receivedAt: number;
}

/** The store's complete item event transition, including the only signal allowed to start MM-1. */
export function applyStatementItemEvent(
  track: ItemTrack,
  event: RunEvent,
  senderItemId: string,
  receivedAt: number,
  demo = false,
): { track: ItemTrack; effect: ItemEffect | "ignored"; paid: PaidSignal | null } {
  const adapted =
    demo && event.type === "item.updated"
      ? (event as RunEvent<"item.updated", ItemUpdatedPayload>)
      : memberEvent(event);
  if (!adapted) return { track, effect: "ignored", paid: null };
  const result = reduceItemEvent(track, adapted, senderItemId);
  const paid =
    result.effect === "applied" && track.status !== "SUCCESS" && confirmedPayment(result.track)
      ? { eventId: event.id, at: event.at, receivedAt }
      : null;
  return { ...result, paid };
}
