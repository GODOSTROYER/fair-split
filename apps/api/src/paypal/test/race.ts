// Ordering harness for Proof plate 6 on the in-process simulator rail (sim.ts): the hero path up to POSTED, with
// every webhook the simulator sent stored and queued but none processed (speed 0), so a test chooses the order of
// the three things that race on a loaded host: the queued `processWebhook` tasks (by event type), the settle GET,
// and "Pay in cash" (our cancel). It reads plate 6 the way a judge's page does: the served bundle and this server's
// verification of it.
import { type ChainVerification, PAYOUT_ITEM_RANK, type ProofBundle } from "@fairsplit/contracts";
import { schema, systemScope } from "@fairsplit/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { expect } from "vitest";
import { payoutsServiceFor } from "../../money/payouts.js";
import { processWebhook, settleBatch } from "../../money/settle.js";
import { ACTORS } from "../../runs/events.js";
import { type RunsHarness, resolveAll, runQueued, signBoth } from "../../runs/test/app.js";
import type { InProcessPayPalSimulator } from "../simulator.js";
import { startSimRuns } from "./sim.js";

export type SimHarness = RunsHarness & { sim: InProcessPayPalSimulator };

/** Invoice → Mark paid → compute → holds → two keys → POST; the simulator then processes the batch (`sim.idle`). */
export async function postedOnSim(): Promise<{ h: SimHarness; batchId: string }> {
  const h = await startSimRuns({ world: { runState: "QUOTED" } });
  const as = h.t.credentials.bearer(h.tokens.treasurer);
  const inv = await h.t.json(`/v1/runs/${h.world.runSlug}/invoice`, { method: "POST", body: {}, as });
  if (inv.status !== 200) throw new Error(`invoice: ${inv.status} ${JSON.stringify(inv.body)}`);
  await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
  await runQueued(h, "computeRun");
  await resolveAll(h);
  await signBoth(h);
  if ((await runQueued(h, "postPayoutBatch")) !== 1) throw new Error("the batch was not posted");
  const [batch] = await h.t.deps.db
    .select({ id: schema.payoutBatches.id })
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  if (!batch) throw new Error("no batch");
  await h.sim.idle();
  return { h, batchId: batch.id };
}

/** Runs the queued `processWebhook` tasks whose stored event type is in `types`, oldest first; returns their types. */
export async function runWebhooksOf(h: SimHarness, types: readonly string[]): Promise<string[]> {
  const tasks = await h.t.deps.db
    .select({ id: schema.taskOutbox.id, args: schema.taskOutbox.args })
    .from(schema.taskOutbox)
    .where(and(eq(schema.taskOutbox.name, "processWebhook"), eq(schema.taskOutbox.state, "queued")))
    .orderBy(asc(schema.taskOutbox.id));
  const stored = await h.t.deps.db
    .select({ id: schema.webhookEvents.id, type: schema.webhookEvents.eventType })
    .from(schema.webhookEvents);
  const typeOf = new Map(stored.map((r) => [r.id, r.type]));
  const ran: string[] = [];
  for (const task of tasks) {
    const type = typeOf.get((task.args as { webhookEventId?: string }).webhookEventId ?? "");
    if (!type || !types.includes(type)) continue;
    await h.t.deps.outbox?.runTask(task.id);
    ran.push(type);
  }
  return ran;
}
export const ITEM_EVENTS = {
  succeeded: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  unclaimed: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  canceled: "PAYMENT.PAYOUTS-ITEM.CANCELED",
} as const;

/** The settle GET (+25 s in Judge Mode, or brought forward by PAYOUTSBATCH.SUCCESS). */
export function settleGet(h: SimHarness, batchId: string, n = 1): Promise<void> {
  return settleBatch(h.t.deps, { batchId, n }, { workspaceId: h.world.workspaceId });
}

/** "Pay in cash at the bodega" on Rhea's parked line (MM-6): our cancel, inline. */
export async function payRheaInCash(h: SimHarness): Promise<void> {
  const lines = await h.t.json<{ lines: { id: string; memberNo: string; state: string }[] }>(
    `/v1/runs/${h.world.runSlug}/lines`,
    { as: h.t.credentials.bearer(h.tokens.treasurer) },
  );
  const rhea = lines.body.lines.find((l) => l.memberNo === "M-031");
  if (rhea?.state !== "UNCLAIMED") throw new Error(`Rhea's line is ${rhea?.state}`);
  await h.t.client(h.tokens.treasurer).payCash({ params: { lineId: rhea.id } });
}

export async function runState(h: SimHarness): Promise<string | undefined> {
  const [run] = await h.t.deps.db
    .select({ state: schema.payRuns.state })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

/** Plate 6 as a judge reads it: this server's verification of the served bundle, and the bundle's items. */
export async function proofNow(h: SimHarness) {
  const v = await h.t.json<{ verification: ChainVerification }>(`/v1/proof/${h.world.runSlug}/verification`);
  if (v.status !== 200) throw new Error(`verification: ${v.status} ${JSON.stringify(v.body)}`);
  const b = await h.t.json<{ bundle: ProofBundle }>(`/v1/proof/${h.world.runSlug}`);
  if (b.status !== 200) throw new Error(`bundle: ${b.status} ${JSON.stringify(b.body)}`);
  const failed = Object.entries(v.body.verification.plates)
    .filter(([, p]) => !p.ok)
    .map(([k, p]) => `${k}: ${p.reason}`);
  const item = (memberNo: string) =>
    b.body.bundle.batch.items.find((i) => i.senderItemId.endsWith(`-${memberNo}`));
  return { status: v.body.verification.status, failed, items: b.body.bundle.batch.items, item };
}

/** The item's held status (the row), by member. */
export async function heldStatus(h: SimHarness, memberNo: string): Promise<string | undefined> {
  const rows = await h.t.deps.db
    .select({ senderItemId: schema.payoutItems.senderItemId, status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .where(eq(schema.payoutItems.workspaceId, h.world.workspaceId));
  return rows.find((r) => r.senderItemId.endsWith(`-${memberNo}`))?.status;
}

/** Rhea's (M-031) chain: our cancel and every `webhook.applied` for her item, in seq order. */
export async function rheaChain(h: SimHarness): Promise<string[]> {
  const rows = await h.t.deps.db
    .select({ kind: schema.ledgerEntries.kind, payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
        inArray(schema.ledgerEntries.kind, ["webhook.applied", "payout.cancel"]),
      ),
    )
    .orderBy(asc(schema.ledgerEntries.seq));
  return rows
    .filter((e) => (e.payload as { senderItemId?: string }).senderItemId?.endsWith("-M-031"))
    .map((e) => {
      const p = e.payload as { eventType?: string; status?: string };
      return e.kind === "payout.cancel" ? "payout.cancel" : `${p.eventType} ${p.status}`;
    });
}

/** Every stored item webhook as `TYPE:status(error)`. */
export async function itemWebhookRows(h: SimHarness): Promise<string[]> {
  const rows = await h.t.deps.db
    .select({
      eventType: schema.webhookEvents.eventType,
      status: schema.webhookEvents.status,
      error: schema.webhookEvents.error,
    })
    .from(schema.webhookEvents);
  return rows
    .filter((r) => r.eventType.startsWith("PAYMENT.PAYOUTS-ITEM."))
    .map((r) => `${r.eventType}:${r.status}${r.error ? `(${r.error})` : ""}`)
    .sort();
}

/**
 * Proof as a judge may open it at any moment of the settlement: every plate holds, no item is served ahead of the
 * status we hold, and an item past submitted/pending always names the verified notice it rests on.
 */
export async function honestProof(h: SimHarness) {
  const p = await proofNow(h);
  expect(p.failed).toEqual([]);
  expect(["verified", "sample"]).toContain(p.status);
  const rows = await h.t.deps.db
    .select({ senderItemId: schema.payoutItems.senderItemId, status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .where(eq(schema.payoutItems.workspaceId, h.world.workspaceId));
  const held = new Map(rows.map((r) => [r.senderItemId, r.status]));
  for (const i of p.items) {
    const row = held.get(i.senderItemId);
    expect(row, i.senderItemId).toBeDefined();
    expect(PAYOUT_ITEM_RANK[i.status], i.senderItemId).toBeLessThanOrEqual(
      PAYOUT_ITEM_RANK[row as keyof typeof PAYOUT_ITEM_RANK],
    );
    expect(i.eventId === null, `${i.senderItemId} ${i.status}`).toBe(
      i.status === "SUBMITTED" || i.status === "PENDING",
    );
  }
  return p;
}

/**
 * Our cancel of Rhea's parked item with `inTheGap` run between PayPal accepting it and our own RETURNED write (the
 * moment a late notice can land in on a busy host). The line then moves to cash through "Pay in cash" as usual.
 */
export async function cancelRheaWith(h: SimHarness, inTheGap: () => Promise<void>): Promise<void> {
  const items = await h.t.deps.db
    .select({ senderItemId: schema.payoutItems.senderItemId, payoutItemId: schema.payoutItems.payoutItemId })
    .from(schema.payoutItems)
    .where(eq(schema.payoutItems.workspaceId, h.world.workspaceId));
  const rhea = items.find((i) => i.senderItemId.endsWith("-M-031"));
  if (!rhea?.payoutItemId) throw new Error("PayPal has not named Rhea's item");
  const scope = systemScope(h.world.workspaceId, ACTORS.outbox);
  const service = await payoutsServiceFor(h.t.deps, scope, {
    repo: (base) => ({
      ...base,
      async applyItemStatus(update) {
        await inTheGap();
        return base.applyItemStatus(update);
      },
    }),
  });
  const outcome = await service.cancelUnclaimed(rhea.payoutItemId, ACTORS.outbox, "cash");
  if (outcome.kind !== "RETURNED") throw new Error(`cancel: ${JSON.stringify(outcome)}`);
  const lines = await h.t.json<{ lines: { id: string; memberNo: string; state: string }[] }>(
    `/v1/runs/${h.world.runSlug}/lines`,
    { as: h.t.credentials.bearer(h.tokens.treasurer) },
  );
  const line = lines.body.lines.find((l) => l.memberNo === "M-031");
  if (line?.state !== "RETURNED") throw new Error(`Rhea's line is ${line?.state}`);
  await h.t.client(h.tokens.treasurer).payCash({ params: { lineId: line.id } });
}

/** Every stored webhook processed once more (an outbox retry, or a redelivery picked up again). */
export async function reprocessEveryWebhook(h: SimHarness): Promise<void> {
  const rows = await h.t.deps.db
    .select({ id: schema.webhookEvents.id, paypalEventId: schema.webhookEvents.paypalEventId })
    .from(schema.webhookEvents);
  for (const r of rows) {
    await processWebhook(
      h.t.deps,
      { webhookEventId: r.id, paypalEventId: r.paypalEventId },
      { complete: async () => undefined },
    );
  }
}

/** How many payout item `webhook.applied` entries the workspace's chain holds. */
export async function appliedEntries(h: SimHarness): Promise<number> {
  const rows = await h.t.deps.db
    .select({ payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
        eq(schema.ledgerEntries.kind, "webhook.applied"),
      ),
    );
  return rows.filter((r) => (r.payload as { resource?: string }).resource === "payout_item").length;
}
