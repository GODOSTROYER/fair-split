// Stored records below are synthetic verified-evidence fixtures, never live PayPal evidence.
import { randomUUID } from "node:crypto";
import { PAYOUT_ITEM_RANK, type PayoutItemStatus } from "@fairsplit/contracts";
import { type Db, schema } from "@fairsplit/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordStrandedBatchesAtBoot } from "../paypal/boot.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { processWebhook } from "./settle.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
});
afterAll(async () => {
  await t?.close();
});

async function fixture(status: PayoutItemStatus = "PENDING", cancel = false) {
  const base = await t.fixture({ members: 2 });
  const [run] = await t.deps.db
    .insert(schema.payRuns)
    .values({
      workspaceId: base.workspaceId,
      seasonId: base.seasonId,
      lotId: base.lotId,
      rateCardId: base.rateCardId,
      seasonCode: "2026A",
      state: "POSTED",
      currency: "USD",
      rateCardSha256: base.rateCardSha256,
      batchSha256: "a".repeat(64),
      senderBatchId: randomUUID(),
      provenance: "simulated_rail",
    })
    .returning();
  if (!run) throw new Error("run");
  const fx = { ...base, runId: run.id };
  const lines = await t.deps.db
    .insert(schema.memberLines)
    .values(
      fx.memberIds.map((memberId) => ({
        workspaceId: fx.workspaceId,
        runId: fx.runId as string,
        memberId,
        state: "PAYPAL_PENDING" as const,
        rail: "ON" as const,
        currency: "USD",
        verifiedG: 1000n,
        grade1G: 0n,
        premiumCents: 100n,
        bonusCents: 0n,
        deductionsCents: 0n,
        creditsCents: 0n,
        netCents: 100n,
        deductions: [],
        provenance: "simulated_rail" as const,
      })),
    )
    .returning();
  const [insertedBatch] = await t.deps.db
    .insert(schema.payoutBatches)
    .values({
      workspaceId: fx.workspaceId,
      runId: fx.runId as string,
      senderBatchId: randomUUID(),
      requestId: "b".repeat(64),
      paypalBatchId: `SIM-${randomUUID()}`,
      batchSha256: "a".repeat(64),
      kind: "primary",
      status: "PENDING",
      itemCount: 2,
      totalCents: 200n,
      currency: "USD",
      provenance: "simulated_rail",
    })
    .returning();
  if (!insertedBatch) throw new Error("batch");
  const batch = insertedBatch;
  const items = await t.deps.db
    .insert(schema.payoutItems)
    .values(
      lines.map((line, i) => ({
        workspaceId: fx.workspaceId,
        batchId: batch.id,
        lineId: line.id,
        senderItemId: `sender-${randomUUID()}`,
        receiver: `member${i}@example.test`,
        amountCents: 100n,
        currency: "USD",
        status: i === 0 ? status : ("PENDING" as const),
        statusRank: i === 0 ? PAYOUT_ITEM_RANK[status] : 10,
        cancelRequestedAt: i === 0 && cancel ? t.clock.now() : null,
        provenance: "simulated_rail" as const,
      })),
    )
    .returning();
  const item = items[0];
  const sibling = items[1];
  if (!item || !sibling) throw new Error("items");
  const event = {
    id: `WH-${randomUUID()}`,
    event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource: {
      payout_item_id: `ITEM${randomUUID().replaceAll("-", "").slice(0, 9).toUpperCase()}`,
      payout_batch_id: batch.paypalBatchId,
      transaction_status: "SUCCESS",
      payout_item: { sender_item_id: item.senderItemId },
    },
  };
  const delivery = {
    transmissionId: randomUUID(),
    transmissionTime: t.clock.now().toISOString(),
    transmissionSig: Buffer.alloc(256, 1).toString("base64"),
    authAlgo: "SHA256withRSA",
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
    certWarning: null,
    rejectReason: null,
  };
  async function store(verifiedDelivery = true) {
    const [row] = await t.deps.db
      .insert(schema.webhookEvents)
      .values({
        paypalEventId: event.id,
        eventType: event.event_type,
        raw: JSON.stringify(event),
        verified: "self",
        delivery: verifiedDelivery ? delivery : null,
        receivedAt: t.clock.now(),
        status: "received",
        provenance: "simulated_rail",
      })
      .returning();
    if (!row) throw new Error("event");
    return row;
  }
  async function snapshot() {
    return {
      items: await t.deps.db
        .select()
        .from(schema.payoutItems)
        .where(eq(schema.payoutItems.batchId, batch.id)),
      lines: await t.deps.db
        .select()
        .from(schema.memberLines)
        .where(eq(schema.memberLines.runId, fx.runId as string)),
      runs: await t.deps.db
        .select()
        .from(schema.payRuns)
        .where(eq(schema.payRuns.id, fx.runId as string)),
      ledger: await t.deps.db
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.workspaceId, fx.workspaceId)),
    };
  }
  async function process(row: Awaited<ReturnType<typeof store>>, db: Db = t.deps.db) {
    let completed = false;
    await processWebhook(
      { ...t.deps, db },
      { webhookEventId: row.id, paypalEventId: event.id },
      {
        complete: async () => {
          completed = true;
        },
      },
    );
    expect(completed).toBe(true);
    const [stored] = await t.deps.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, row.id));
    return stored;
  }
  return { fx, batch, item, sibling, event, store, snapshot, process };
}

function atTransaction(fn: () => Promise<void>): Db {
  return new Proxy(t.deps.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return async (...args: Parameters<Db["transaction"]>) => {
          await fn();
          return target.transaction(...args);
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("W1 security review: stored simulated evidence", () => {
  it.each([false, true])(
    "inv.i5.stranded: boot before apply (race=%s) records the notice without a GET or money change",
    async (race) => {
      const f = await fixture();
      const row = await f.store();
      let before = await f.snapshot();
      const boot = async () => {
        await recordStrandedBatchesAtBoot(t.deps);
        before = await f.snapshot();
      };
      if (!race) await boot();
      const stored = await f.process(row, race ? atTransaction(boot) : t.deps.db);
      expect(await f.snapshot()).toEqual(before);
      expect(stored).toMatchObject({
        status: "orphan",
        error: "STRANDED_BATCH",
        appliedAt: null,
        workspaceId: f.fx.workspaceId,
      });
      const tasks = await t.deps.db
        .select()
        .from(schema.taskOutbox)
        .where(eq(schema.taskOutbox.workspaceId, f.fx.workspaceId));
      expect(tasks).toEqual([]);
      const received = await t.deps.db
        .select()
        .from(schema.runEvents)
        .where(eq(schema.runEvents.workspaceId, f.fx.workspaceId));
      expect(received.filter((e) => e.type === "webhook.received")).toHaveLength(1);
    },
  );

  it.each([false, true])(
    "inv.i5.sibling-id: conflicting ID (race=%s) is consumed without a unique-key retry",
    async (race) => {
      const f = await fixture();
      const row = await f.store();
      let before = await f.snapshot();
      const bind = async () => {
        await t.deps.db
          .update(schema.payoutItems)
          .set({ payoutItemId: f.event.resource.payout_item_id })
          .where(eq(schema.payoutItems.id, f.sibling.id));
        before = await f.snapshot();
      };
      if (!race) await bind();
      expect(await f.process(row, race ? atTransaction(bind) : t.deps.db)).toMatchObject({
        status: "orphan",
        appliedAt: null,
      });
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it("inv.i5.orphan-race: a late orphan worker cannot overwrite a committed applied record", async () => {
    const f = await fixture();
    const row = await f.store();
    await t.deps.db
      .update(schema.payoutItems)
      .set({ payoutItemId: f.event.resource.payout_item_id })
      .where(eq(schema.payoutItems.id, f.sibling.id));
    const db = atTransaction(async () => {
      await t.deps.db
        .update(schema.webhookEvents)
        .set({ status: "applied", appliedAt: t.clock.now() })
        .where(eq(schema.webhookEvents.id, row.id));
    });
    expect(await f.process(row, db)).toMatchObject({ status: "applied", appliedAt: t.clock.now() });
  });

  it.each(["sender", "batch", "item", "missing"])(
    "inv.i5.fresh-get: %s identity mismatch defers without binding or applying",
    async (mismatch) => {
      const f = await fixture();
      const row = await f.store(false);
      const before = await f.snapshot();
      const original = t.deps.paypal.core.http.request;
      let calls = 0;
      t.deps.paypal.core.http.request = new Proxy(original, {
        apply() {
          calls++;
          return Promise.resolve({
            ok: true,
            status: 200,
            body: {
              payout_item_id: mismatch === "item" ? "OTHER-ITEM" : f.event.resource.payout_item_id,
              payout_batch_id: mismatch === "batch" ? "OTHER-BATCH" : f.batch.paypalBatchId,
              transaction_status: "SUCCESS",
              payout_item:
                mismatch === "missing"
                  ? {}
                  : {
                      sender_item_id: mismatch === "sender" ? f.sibling.senderItemId : f.item.senderItemId,
                    },
            },
          });
        },
      });
      try {
        expect(await f.process(row)).toMatchObject({ status: "orphan", appliedAt: null });
        expect(calls).toBe(1);
        expect(await f.snapshot()).toEqual(before);
        const tasks = await t.deps.db
          .select()
          .from(schema.taskOutbox)
          .where(eq(schema.taskOutbox.workspaceId, f.fx.workspaceId));
        expect(tasks).toEqual([expect.objectContaining({ name: "settleBatch", state: "queued" })]);
      } finally {
        t.deps.paypal.core.http.request = original;
      }
    },
  );

  it.each(["RETURNED", "FAILED", "BLOCKED", "UNCLAIMED"] as PayoutItemStatus[])(
    "inv.i5.decided-money: %s requires a GET before stored SUCCESS",
    async (status) => {
      const f = await fixture(status, status === "UNCLAIMED" || status === "RETURNED");
      const row = await f.store();
      const before = await f.snapshot();
      const original = t.deps.paypal.core.http.request;
      let gets = 0;
      t.deps.paypal.core.http.request = new Proxy(original, {
        apply() {
          gets++;
          throw new Error("fresh GET required");
        },
      });
      try {
        await expect(f.process(row)).rejects.toThrow("fresh GET required");
        expect(gets).toBe(1);
        expect(await f.snapshot()).toEqual(before);
      } finally {
        t.deps.paypal.core.http.request = original;
      }
    },
  );
});
