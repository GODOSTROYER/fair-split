// /ops metrics (S3.15): webhook latency at p50 and p95 for record-payment → INVOICE.PAID, and for the batch POST
// → the first item event, → SUCCESS and → UNCLAIMED; plus the counts behind the quotas (posts in the last 24 h,
// live runs). Durations are measured between our own clock readings (when we recorded the act, when the
// verified delivery reached us), so they say how fast PayPal's notices land here, never PayPal's internals.
//
// A delivery counts for an act only when it was resolved to the act's own workspace: resource keys are not
// unique across tenants (judge workspaces cloned from one replay share PayPal resource ids), so a key match
// alone would mix another tenant's deliveries into these figures. The workspace view reads nothing else.
import { type DbOrTx, schema } from "@fairsplit/db";
import { format } from "@fairsplit/domain";
import { and, eq, gte, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { OpsView } from "./access.js";

const Latency = z.strictObject({
  samples: z.int().nonnegative(),
  p50Ms: z.int().nonnegative().nullable(),
  p95Ms: z.int().nonnegative().nullable(),
  display: z.string(),
});

export const OpsMetrics = z.strictObject({
  view: z.enum(["operator", "workspace"]),
  latency: z.strictObject({
    recordToInvoicePaid: Latency,
    postToFirstItemEvent: Latency,
    postToSuccess: Latency,
    postToUnclaimed: Latency,
  }),
  posts: z.strictObject({ last24h: z.int().nonnegative(), batches: z.int().nonnegative() }),
  runs: z.strictObject({ total: z.int().nonnegative(), settled: z.int().nonnegative() }),
});
export type OpsMetrics = z.infer<typeof OpsMetrics>;

/** Nearest-rank percentile of sorted samples. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? null;
}

export function latency(samples: readonly number[]): z.infer<typeof Latency> {
  const sorted = samples.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  return {
    samples: sorted.length,
    p50Ms: p50,
    p95Ms: p95,
    display:
      p50 === null || p95 === null
        ? "No samples yet"
        : `p50 ${format.elapsedWords(p50)}, p95 ${format.elapsedWords(p95)}`,
  };
}

function scope(col: Parameters<typeof eq>[0], view: OpsView): SQL | undefined {
  return view.kind === "workspace" ? eq(col, view.workspaceId) : undefined;
}

export async function opsMetrics(db: DbOrTx, view: OpsView, now: Date): Promise<OpsMetrics> {
  const we = schema.webhookEvents;

  // record-payment → INVOICE.PAID (the invoice's PayPal id is the event's resource key)
  const inv = schema.invoices;
  const invoices = await db
    .select({
      workspaceId: inv.workspaceId,
      paypalInvoiceId: inv.paypalInvoiceId,
      recordedAt: inv.paymentRecordedAt,
    })
    .from(inv)
    .where(
      and(isNotNull(inv.paymentRecordedAt), isNotNull(inv.paypalInvoiceId), scope(inv.workspaceId, view)),
    );
  const invoiceIds = invoices.map((i) => i.paypalInvoiceId as string);
  const paidEvents =
    invoiceIds.length === 0
      ? []
      : await db
          .select({ workspaceId: we.workspaceId, key: we.resourceKey, at: we.receivedAt })
          .from(we)
          .where(
            and(
              eq(we.eventType, "INVOICING.INVOICE.PAID"),
              inArray(we.resourceKey, invoiceIds),
              scope(we.workspaceId, view),
            ),
          );
  const recordToPaid = invoices.flatMap((i) => {
    const first = paidEvents
      .filter((e) => e.key === i.paypalInvoiceId && e.workspaceId === i.workspaceId)
      .map((e) => e.at.getTime())
      .sort((a, b) => a - b)[0];
    return first !== undefined && i.recordedAt ? [first - i.recordedAt.getTime()] : [];
  });

  // batch POST → item events (events resolve by sender_item_id or payout_item_id)
  const pb = schema.payoutBatches;
  const batches = await db
    .select({ id: pb.id, workspaceId: pb.workspaceId, submittedAt: pb.submittedAt })
    .from(pb)
    .where(scope(pb.workspaceId, view));
  const pi = schema.payoutItems;
  const items =
    batches.length === 0
      ? []
      : await db
          .select({
            workspaceId: pi.workspaceId,
            batchId: pi.batchId,
            senderItemId: pi.senderItemId,
            payoutItemId: pi.payoutItemId,
          })
          .from(pi)
          .where(
            and(
              inArray(
                pi.batchId,
                batches.map((b) => b.id),
              ),
              scope(pi.workspaceId, view),
            ),
          );
  const keys = items.flatMap((i) => [i.senderItemId, ...(i.payoutItemId ? [i.payoutItemId] : [])]);
  const itemEvents =
    keys.length === 0
      ? []
      : await db
          .select({ workspaceId: we.workspaceId, key: we.resourceKey, type: we.eventType, at: we.receivedAt })
          .from(we)
          .where(
            and(
              inArray(we.resourceKey, keys),
              sql`${we.eventType} like 'PAYMENT.PAYOUTS-ITEM.%'`,
              scope(we.workspaceId, view),
            ),
          );
  // a resource key names an item only within the item's own workspace
  const keyOf = (workspaceId: string, key: string) => `${workspaceId}|${key}`;
  const batchOfKey = new Map<string, string>();
  for (const i of items) {
    batchOfKey.set(keyOf(i.workspaceId, i.senderItemId), i.batchId);
    if (i.payoutItemId) batchOfKey.set(keyOf(i.workspaceId, i.payoutItemId), i.batchId);
  }
  const first: number[] = [];
  const success: number[] = [];
  const unclaimed: number[] = [];
  for (const b of batches) {
    const evs = itemEvents.filter(
      (e) => e.key !== null && e.workspaceId !== null && batchOfKey.get(keyOf(e.workspaceId, e.key)) === b.id,
    );
    if (evs.length === 0) continue;
    const t0 = b.submittedAt.getTime();
    first.push(Math.min(...evs.map((e) => e.at.getTime())) - t0);
    for (const e of evs) {
      if (e.type === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED") success.push(e.at.getTime() - t0);
      if (e.type === "PAYMENT.PAYOUTS-ITEM.UNCLAIMED") unclaimed.push(e.at.getTime() - t0);
    }
  }

  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [posts] = await db
    .select({ n: sql<number>`count(*)` })
    .from(pb)
    .where(and(gte(pb.submittedAt, dayAgo), scope(pb.workspaceId, view)));
  const pr = schema.payRuns;
  const [runs] = await db
    .select({
      total: sql<number>`count(*)`,
      settled: sql<number>`count(*) filter (where ${pr.state} in ('SETTLED', 'CLOSED'))`,
    })
    .from(pr)
    .where(scope(pr.workspaceId, view));

  return {
    view: view.kind,
    latency: {
      recordToInvoicePaid: latency(recordToPaid),
      postToFirstItemEvent: latency(first),
      postToSuccess: latency(success),
      postToUnclaimed: latency(unclaimed),
    },
    posts: { last24h: Number(posts?.n ?? 0), batches: batches.length },
    runs: { total: Number(runs?.total ?? 0), settled: Number(runs?.settled ?? 0) },
  };
}
