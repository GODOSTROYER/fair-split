// processWebhook under WS-PPCORE's apply contract (webhooks/apply.ts rule 3; plan "PayPal integration
// contract": a verified SUCCEEDED applies, any other status needs a fresh GET). A batch event never writes
// the batch's status or moves the run from its own payload: SUCCESS and DENIED bring the settle GET forward,
// PROCESSING waits for the scheduled one (we never poll). An item event that needs a GET but arrives before
// PayPal named the item (no payout_item_id to GET) changes nothing and hands the decision to the batch GET.
import { schema } from "@fairsplit/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/testing/app.js";
import { paypalScript, TEST_BATCH_ID } from "../runs/testing/paypal.js";
import { processWebhook } from "./settle.js";

const script = paypalScript();
let h: RunsHarness;
const complete = { complete: async () => undefined };

async function storeWebhook(event: { id: string; event_type: string; resource: Record<string, unknown> }) {
  const db = h.t.pg?.owner.db;
  if (!db) throw new Error("db");
  const [row] = await db
    .insert(schema.webhookEvents)
    .values({
      paypalEventId: event.id,
      eventType: event.event_type,
      verified: "self",
      raw: JSON.stringify(event),
      status: "received",
      provenance: "live",
    })
    .returning({ id: schema.webhookEvents.id });
  return row?.id as string;
}

async function deliver(event: { id: string; event_type: string; resource: Record<string, unknown> }) {
  const id = await storeWebhook(event);
  await processWebhook(h.t.deps, { webhookEventId: id, paypalEventId: event.id }, complete);
  const [row] = await h.t.deps.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, id));
  return row;
}

async function batchRow() {
  const [b] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  if (!b) throw new Error("batch");
  return b;
}

async function runState() {
  const [run] = await h.t.deps.db
    .select({ state: schema.payRuns.state })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

async function settleRows(eventId: string) {
  const b = await batchRow();
  return h.t.deps.db
    .select({ id: schema.taskOutbox.id, key: schema.taskOutbox.dedupeKey, state: schema.taskOutbox.state })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.name, "settleBatch"),
        like(schema.taskOutbox.dedupeKey, `settle:${b.id}:%:wh:${eventId}`),
      ),
    );
}

async function appliedLedger() {
  const rows = await h.t.deps.db
    .select({ payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
        eq(schema.ledgerEntries.kind, "webhook.applied"),
      ),
    );
  return rows.map((r) => r.payload as { eventId: string; resource: string });
}

const batchEvent = (id: string, status: "PROCESSING" | "SUCCESS" | "DENIED") => ({
  id,
  event_type: `PAYMENT.PAYOUTSBATCH.${status}`,
  resource: { batch_header: { payout_batch_id: TEST_BATCH_ID, batch_status: status } },
});

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers });
  await resolveAll(h);
  await signBoth(h);
  await runQueued(h, "postPayoutBatch");
});
afterAll(async () => h?.close());

describe("processWebhook: only a GET changes state (apply contract rule 3)", () => {
  it("an item event that needs a GET, before PayPal named the item: nothing changes; the batch GET decides", async () => {
    expect(await runState()).toBe("POSTED");
    const m014 = script.posted[0]?.items.find((i) => i.sender_item_id.endsWith("M-014"));
    const calls = script.calls.length;
    const row = await deliver({
      id: "WH-CONTRACT-ITEM-1",
      event_type: "PAYMENT.PAYOUTS-ITEM.FAILED",
      resource: {
        payout_batch_id: TEST_BATCH_ID,
        transaction_status: "FAILED",
        payout_item: { sender_item_id: m014?.sender_item_id },
      },
    });
    expect(script.calls.length).toBe(calls);
    const [item] = await h.t.deps.db
      .select()
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.senderItemId, m014?.sender_item_id as string));
    expect(item).toMatchObject({ status: "PENDING", payoutItemId: null });
    expect(row).toMatchObject({ status: "applied", workspaceId: h.world.workspaceId });
    expect(await settleRows("WH-CONTRACT-ITEM-1")).toHaveLength(1);
    expect((await appliedLedger()).map((e) => e.eventId)).not.toContain("WH-CONTRACT-ITEM-1");
    expect(await runState()).toBe("POSTED");
  });

  it("PAYOUTSBATCH.PROCESSING writes no batch status and moves no run; the scheduled settle GET decides", async () => {
    const calls = script.calls.length;
    const row = await deliver(batchEvent("WH-CONTRACT-BATCH-P", "PROCESSING"));
    expect(row?.status).toBe("applied");
    expect(script.calls.length).toBe(calls);
    expect((await batchRow()).status).toBe("PENDING");
    expect(await runState()).toBe("POSTED");
    expect(await settleRows("WH-CONTRACT-BATCH-P")).toHaveLength(0);
    expect((await appliedLedger()).map((e) => e.eventId)).not.toContain("WH-CONTRACT-BATCH-P");
  });

  it("PAYOUTSBATCH.SUCCESS only brings the settle GET forward; that GET writes the status and moves the run", async () => {
    await deliver(batchEvent("WH-CONTRACT-BATCH-S", "SUCCESS"));
    expect((await batchRow()).status).toBe("PENDING");
    expect(await runState()).toBe("POSTED");
    const [settle] = await settleRows("WH-CONTRACT-BATCH-S");
    expect(settle?.state).toBe("queued");
    await h.t.deps.outbox?.runTask(settle?.id as string);
    expect(script.calls.at(-1)).toBe("get_payout_batch");
    expect((await batchRow()).status).toBe("SUCCESS");
    expect(await runState()).toBe("NEEDS_FOLLOW_UP");
    expect((await appliedLedger()).filter((e) => e.resource === "payout_batch")).toHaveLength(0);
  });

  it("PAYOUTSBATCH.DENIED is confirmed by a GET first: the payload's DENIED is never written", async () => {
    await deliver(batchEvent("WH-CONTRACT-BATCH-D", "DENIED"));
    expect((await batchRow()).status).toBe("SUCCESS");
    expect(await settleRows("WH-CONTRACT-BATCH-D")).toHaveLength(1);
  });
});
