// processWebhook under WS-PPCORE's apply contract (webhooks/apply.ts rule 3; plan "PayPal integration
// contract": a verified SUCCEEDED applies, any other status needs a fresh GET). A batch event never writes
// the batch's status or moves the run from its own payload: SUCCESS and DENIED bring the settle GET forward,
// PROCESSING waits for the scheduled one (we never poll). An item event that needs a GET but arrives before
// PayPal named the item (no payout_item_id to GET) changes nothing and hands the decision to the batch GET.
import type { WebhookVerified } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript, TEST_BATCH_ID } from "../runs/test/paypal.js";
import { processWebhook } from "./settle.js";

const script = paypalScript();
let h: RunsHarness;
const complete = { complete: async () => undefined };

async function storeWebhook(
  event: { id: string; event_type: string; resource: Record<string, unknown> },
  verified: WebhookVerified = "self",
) {
  const db = h.t.pg?.owner.db;
  if (!db) throw new Error("db");
  const [row] = await db
    .insert(schema.webhookEvents)
    .values({
      paypalEventId: event.id,
      eventType: event.event_type,
      verified,
      raw: JSON.stringify(event),
      status: "received",
      provenance: "live",
    })
    .returning({ id: schema.webhookEvents.id });
  return row?.id as string;
}

async function deliver(
  event: { id: string; event_type: string; resource: Record<string, unknown> },
  verified: WebhookVerified = "self",
) {
  const id = await storeWebhook(event, verified);
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
  return rows.map(
    (r) =>
      r.payload as {
        eventId: string;
        eventType: string;
        resource: string;
        senderItemId?: string;
        payoutItemId?: string;
        status?: string;
        verified?: string;
      },
  );
}

/** An item event for a member's item, by the payout_item_id the settle GET recorded. */
async function itemEvent(id: string, memberNo: string, type: "SUCCEEDED" | "UNCLAIMED") {
  const [item] = await h.t.deps.db
    .select()
    .from(schema.payoutItems)
    .where(
      and(
        eq(schema.payoutItems.workspaceId, h.world.workspaceId),
        like(schema.payoutItems.senderItemId, `%-${memberNo}`),
      ),
    );
  if (!item?.payoutItemId) throw new Error(`no named item for ${memberNo}`);
  return {
    item,
    event: {
      id,
      event_type: `PAYMENT.PAYOUTS-ITEM.${type}`,
      resource: {
        payout_item_id: item.payoutItemId,
        payout_batch_id: TEST_BATCH_ID,
        transaction_status: type === "SUCCEEDED" ? "SUCCESS" : "UNCLAIMED",
        payout_item: { sender_item_id: item.senderItemId },
      },
    },
  };
}

async function itemUpdates(senderItemId: string) {
  const rows = await h.t.deps.db
    .select({ payload: schema.runEvents.payload })
    .from(schema.runEvents)
    .where(
      and(eq(schema.runEvents.workspaceId, h.world.workspaceId), eq(schema.runEvents.type, "item.updated")),
    );
  return rows.filter((r) => (r.payload as { senderItemId?: string }).senderItemId === senderItemId).length;
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
    expect(row).toMatchObject({ status: "orphan", appliedAt: null, workspaceId: h.world.workspaceId });
    expect(await settleRows("WH-CONTRACT-ITEM-1")).toHaveLength(1);
    expect((await appliedLedger()).map((e) => e.eventId)).not.toContain("WH-CONTRACT-ITEM-1");
    expect(await runState()).toBe("POSTED");
  });

  it("PAYOUTSBATCH.PROCESSING writes no batch status and moves no run; the scheduled settle GET decides", async () => {
    const calls = script.calls.length;
    const row = await deliver(batchEvent("WH-CONTRACT-BATCH-P", "PROCESSING"));
    expect(row).toMatchObject({ status: "orphan", appliedAt: null, error: "SETTLE_GET_REQUIRED" });
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

// Proof plate 6 wants every item status to rest on a verified `webhook.applied` entry. A status can land before
// PayPal's signed event for it: the settle GET can read a SUCCESS before its SUCCEEDED is processed, and our cancel
// sets Rhea's RETURNED from PayPal's answer before the signed CANCELED arrives. The event then changes nothing, but
// when its fresh GET confirms the status it names, it is what that status rests on: one `webhook.applied`, no
// `item.updated`. An event that names another status, a second event for a status already resting on one, and a
// `dev_mock` event attest nothing.
describe("processWebhook: a verified event confirms the status already applied (Proof plate 6)", () => {
  it("a SUCCEEDED whose GET confirms the SUCCESS the settle GET applied rests that status on the event", async () => {
    const { item, event } = await itemEvent("WH-CONFIRM-SUCCESS", "M-014", "SUCCEEDED");
    expect(item.status).toBe("SUCCESS");
    const updates = await itemUpdates(item.senderItemId);
    const calls = script.calls.length;
    const row = await deliver(event);
    expect(script.calls.slice(calls)).toEqual(["get_payout_item"]);
    expect(row?.status).toBe("applied");
    expect(await itemUpdates(item.senderItemId)).toBe(updates);
    expect((await appliedLedger()).filter((e) => e.senderItemId === item.senderItemId)).toEqual([
      {
        eventId: "WH-CONFIRM-SUCCESS",
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        verified: "self",
        provenance: expect.any(String),
        resource: "payout_item",
        senderItemId: item.senderItemId,
        payoutItemId: item.payoutItemId,
        status: "SUCCESS",
      },
    ]);
  });

  it("a second verified event for a status that already rests on one adds nothing", async () => {
    const { item, event } = await itemEvent("WH-CONFIRM-SUCCESS-2", "M-014", "SUCCEEDED");
    await deliver(event);
    expect(
      (await appliedLedger()).filter((e) => e.senderItemId === item.senderItemId).map((e) => e.eventId),
    ).toEqual(["WH-CONFIRM-SUCCESS"]);
  });

  it("an event whose GET reads another status confirms nothing (Rhea's SUCCEEDED, PayPal says UNCLAIMED)", async () => {
    const { item, event } = await itemEvent("WH-CONFIRM-WRONG", "M-031", "SUCCEEDED");
    expect(item.status).toBe("UNCLAIMED");
    await deliver(event);
    const [now] = await h.t.deps.db
      .select()
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.id, item.id));
    expect(now?.status).toBe("UNCLAIMED");
    expect((await appliedLedger()).filter((e) => e.senderItemId === item.senderItemId)).toEqual([]);
  });

  it("a dev_mock event attests nothing; PayPal's signed UNCLAIMED then rests Rhea's status on itself", async () => {
    const mock = await itemEvent("WH-CONFIRM-MOCK", "M-031", "UNCLAIMED");
    await deliver(mock.event, "dev_mock");
    expect((await appliedLedger()).filter((e) => e.senderItemId === mock.item.senderItemId)).toEqual([]);
    const signed = await itemEvent("WH-CONFIRM-UNCLAIMED", "M-031", "UNCLAIMED");
    await deliver(signed.event);
    expect(
      (await appliedLedger())
        .filter((e) => e.senderItemId === mock.item.senderItemId)
        .map((e) => [e.eventId, e.status, e.verified]),
    ).toEqual([["WH-CONFIRM-UNCLAIMED", "UNCLAIMED", "self"]]);
  });
});
