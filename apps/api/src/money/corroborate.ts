// Corroboration (I5, Proof plate 6): every payout item status rests on a verified PayPal notice in the chain, in
// the order the verifier folds them. A status can land before its notice is chained: the settle GET reads SUCCESS or
// UNCLAIMED before the item's signed notice is processed, and our cancel records RETURNED from PayPal's answer before
// the signed CANCELED arrives. On a busy host the notices are also processed out of order: Rhea's UNCLAIMED after she
// was moved to cash, or inside the moment between PayPal accepting the cancel and our own RETURNED write.
//
// `corroborateItems` closes that gap whenever an item or its notices moved. It folds the item's chain exactly as
// plate 6 does (proof/item-fold.ts) and, while that fold is behind the status we hold, chains the stored notices that
// carry it forward, lowest status first: one `webhook.applied` entry per step, each naming the status its own event
// type names. A notice qualifies only if it is a stored, verified (never `dev_mock`, never replayed) event that
// `processWebhook` already resolved to this item and checked against PayPal (applied, or left NO_APPLY), and the
// status it names is one the item holds or went through on the way (an UNCLAIMED notice for an item now RETURNED).
// Nothing here changes an item, a line or a run: it only writes the evidence a status already rests on, so a late
// notice is never dropped and no entry ever claims a status its event does not name.
import {
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  type Provenance,
  type WebhookEventType,
  WebhookEventType as WebhookEventTypeSchema,
  type WebhookVerified,
} from "@fairsplit/contracts";
import { schema, type Tx, type WorkspaceScope } from "@fairsplit/db";
import { itemMachine } from "@fairsplit/domain";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { foldItemEvents, type ItemFold } from "../proof/item-fold.js";
import { ACTORS, proofLedger } from "../runs/events.js";
import { type ItemRow, itemStatusOf } from "./items.js";

/** Statuses nothing follows: a notice naming one attests an item only while the item holds exactly that status. */
const DEAD_ENDS: ReadonlySet<PayoutItemStatus> = new Set(["RETURNED", "FAILED", "BLOCKED"]);

/** Whether an item holding `held` holds `named`, or went through it to get there. */
export function holdsOrPassed(named: PayoutItemStatus, held: PayoutItemStatus): boolean {
  if (named === held) return true;
  return named !== "SUBMITTED" && !DEAD_ENDS.has(named) && PAYOUT_ITEM_RANK[named] < PAYOUT_ITEM_RANK[held];
}

interface Notice {
  id: string;
  paypalEventId: string;
  eventType: WebhookEventType;
  verified: WebhookVerified;
  provenance: Provenance;
  named: PayoutItemStatus;
}

/**
 * Chains the stored notices each item's held status still lacks (see the header). `items` are the rows as they
 * stand, read under the workspace lock of `tx`. Returns the ids of the `webhook_events` rows chained (each is
 * marked applied).
 */
export async function corroborateItems(
  tx: Tx,
  scope: WorkspaceScope,
  items: readonly ItemRow[],
  o: { at: Date; runId: string },
): Promise<Set<string>> {
  const chained = new Set<string>();
  // A replayed item rests on its labelled replay record, never on a notice; an unnamed one has no notice to rest on.
  const open = items.filter((i) => i.payoutItemId !== null && i.provenance !== "replay");
  if (open.length === 0) return chained;
  const l = schema.ledgerEntries;
  const entries = await tx
    .select({ kind: l.kind, payload: l.payload })
    .from(l)
    .where(and(eq(l.workspaceId, scope.workspaceId), inArray(l.kind, ["webhook.applied", "payout.cancel"])))
    .orderBy(asc(l.seq));
  const folds = foldItemEvents(entries);
  const cancelled = new Set(
    entries
      .filter((e) => e.kind === "payout.cancel")
      .map((e) => (e.payload as { senderItemId?: unknown } | null)?.senderItemId),
  );
  const w = schema.webhookEvents;
  for (const item of open) {
    const held = item.status as PayoutItemStatus;
    let fold: ItemFold = folds.get(item.senderItemId) ?? { status: "SUBMITTED", lastEventId: null };
    if (fold.status === held || item.payoutItemId === null) continue;
    const rows = await tx
      .select({
        id: w.id,
        paypalEventId: w.paypalEventId,
        eventType: w.eventType,
        verified: w.verified,
        provenance: w.provenance,
      })
      .from(w)
      .where(
        and(
          eq(w.workspaceId, scope.workspaceId),
          inArray(w.resourceKey, [item.payoutItemId, item.senderItemId]),
          like(w.eventType, "PAYMENT.PAYOUTS-ITEM.%"),
          or(eq(w.status, "applied"), and(eq(w.status, "orphan"), eq(w.error, "NO_APPLY"))),
        ),
      )
      .orderBy(asc(w.receivedAt), asc(w.createdAt));
    const pool: Notice[] = [];
    for (const r of rows) {
      const type = WebhookEventTypeSchema.safeParse(r.eventType);
      const named = itemStatusOf(r.eventType);
      if (!type.success || !named) continue;
      if (r.verified === null || r.verified === "dev_mock" || r.provenance === "replay") continue;
      if (!holdsOrPassed(named, held)) continue;
      pool.push({
        id: r.id,
        paypalEventId: r.paypalEventId,
        eventType: type.data,
        verified: r.verified,
        provenance: r.provenance as Provenance,
        named,
      });
    }
    const cancelRequested = cancelled.has(item.senderItemId);
    while (fold.status !== held) {
      const at = fold.status;
      // the lowest step first (UNCLAIMED before the RETURNED that needs it); among equals, the first received
      const next = pool
        .filter((n) => !chained.has(n.id) && itemMachine.apply(at, n.named, { cancelRequested }).applied)
        .sort((a, b) => PAYOUT_ITEM_RANK[a.named] - PAYOUT_ITEM_RANK[b.named])[0];
      if (!next) break;
      await proofLedger(
        tx,
        scope,
        "webhook.applied",
        {
          eventId: next.paypalEventId,
          eventType: next.eventType,
          verified: next.verified,
          provenance: next.provenance,
          resource: "payout_item",
          senderItemId: item.senderItemId,
          payoutItemId: item.payoutItemId,
          status: next.named,
        },
        { runId: o.runId, at: o.at, actor: ACTORS.paypalWebhook },
      );
      await tx.update(w).set({ status: "applied", appliedAt: o.at, error: null }).where(eq(w.id, next.id));
      chained.add(next.id);
      fold = { status: next.named, lastEventId: next.paypalEventId };
    }
  }
  return chained;
}
