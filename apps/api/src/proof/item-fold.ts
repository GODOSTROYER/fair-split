// Proof plate 6's fold of one item's chain, as the verifier replays it (packages/domain verify-core): pure, so the
// bundle builder (./bundle.ts), the brand export and the money slice (money/corroborate.ts) all read an item's
// attested status the same way the check will.
import { LedgerPayloads, PAYOUT_ITEM_RANK, type PayoutItemStatus } from "@fairsplit/contracts";
import { applyItemStatus, itemStatusFromEvent } from "@fairsplit/domain";

export interface ItemFold {
  status: PayoutItemStatus;
  lastEventId: string | null;
}

/**
 * The forward-only fold of the chain's `webhook.applied` item entries, exactly as plate 6 replays it: an event
 * applies only if its status outranks the current one, and RETURNED only after our own `payout.cancel`.
 */
export function foldItemEvents(ledger: readonly { kind: string; payload: unknown }[]): Map<string, ItemFold> {
  const out = new Map<string, ItemFold>();
  const cancelled = new Set<string>();
  for (const e of ledger) {
    if (e.kind === "payout.cancel") {
      const p = LedgerPayloads["payout.cancel"].safeParse(e.payload);
      if (p.success) cancelled.add(p.data.senderItemId);
      continue;
    }
    if (e.kind !== "webhook.applied") continue;
    const p = LedgerPayloads["webhook.applied"].safeParse(e.payload);
    if (!p.success || p.data.resource !== "payout_item") continue;
    const ev = p.data;
    if (
      ev.verified === "dev_mock" ||
      ev.provenance === "replay" ||
      itemStatusFromEvent(ev.eventType) !== ev.status
    )
      continue;
    const cur = out.get(ev.senderItemId) ?? { status: "SUBMITTED" as PayoutItemStatus, lastEventId: null };
    const applied = applyItemStatus(cur.status, ev.status, {
      cancelRequested: cancelled.has(ev.senderItemId),
    });
    if (applied.applied) out.set(ev.senderItemId, { status: applied.next, lastEventId: ev.eventId });
    else out.set(ev.senderItemId, cur);
  }
  return out;
}

/**
 * What Proof serves for an item: the status the chain's verified notices attest, and the notice it rests on. The
 * status we hold can run ahead of them (the settle GET reads a SUCCESS before its SUCCEEDED is processed; our cancel
 * records Rhea's RETURNED from PayPal's answer before the signed CANCELED arrives). Proof never shows that lead as
 * confirmed: until a notice lands the item reads as submitted (or pending, which needs no notice), and it catches up
 * as each one is chained. A chain that attests more than we hold is not served as attested: the held status goes out
 * with no event, and plate 6 refuses it.
 */
export function attestedItem(
  held: PayoutItemStatus,
  fold: ItemFold | undefined,
): { status: PayoutItemStatus; eventId: string | null } {
  if (!fold || fold.lastEventId === null) {
    return { status: held === "PENDING" ? "PENDING" : "SUBMITTED", eventId: null };
  }
  if (fold.status === held || PAYOUT_ITEM_RANK[fold.status] < PAYOUT_ITEM_RANK[held]) {
    return { status: fold.status, eventId: fold.lastEventId };
  }
  return { status: held, eventId: null };
}
