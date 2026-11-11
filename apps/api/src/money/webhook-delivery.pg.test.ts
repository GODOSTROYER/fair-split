// W1 / MM-1: real simulated PayPal signatures, real Postgres persistence and dispatcher, real SSE.
// The timing observer runs immediately before COMMIT, a conservative upper bound on commit-to-SSE latency.
// Synthetic fixture money below exists only on the in-process simulator, labelled simulated_rail throughout.
import { randomUUID } from "node:crypto";
import { RunEvent } from "@fairsplit/contracts";
import { type Db, schema, type Tx } from "@fairsplit/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_VERSION, createApp, type FairSplitApp } from "../app.js";
import { startSimApp, startTestSimulator, type TestSimulator } from "../paypal/test/sim.js";
import { createWebhookHandler } from "../paypal/webhooks.js";
import type { SseReader, TestApp } from "../test/index.js";
import { assertWebhookLatency } from "../test/webhook-timing.js";
import { processWebhook } from "./settle.js";

const count = 24;
const warmup = 4;
const successCount = count + warmup;
const deliveries: Request[] = [];
let s: TestSimulator;
let t: TestApp;
let workspaceId: string;
let runId: string;
let runSlug: string;
let token: string;
let timedApp: FairSplitApp;
let beforeCommitAt = Number.NaN;
const httpCalls: { method: string; path: string; purpose: string }[] = [];
const processingTimes = new Map<string, { started: number; finished?: number }>();

beforeAll(async () => {
  s = await startTestSimulator({ duplicate: true });
  t = await startSimApp(s, {
    db: "postgres",
    dispatcher: true,
    taskHandlers: {
      processWebhook: async (args, ctx) => {
        const eventId = String(args.paypalEventId);
        const times = { started: performance.now(), finished: undefined as number | undefined };
        processingTimes.set(eventId, times);
        const handler = t.app.registry.taskHandlers(t.deps).processWebhook;
        if (!handler) throw new Error("production webhook handler missing");
        try {
          await handler(args, ctx);
        } finally {
          times.finished = performance.now();
        }
      },
    },
  });
  // Observe actual calls and retain the real HTTP implementation. The test harness has no paypal_calls
  // recorder; querying that table would falsely claim no GET happened.
  t.deps.paypal.core.http.request = new Proxy(t.deps.paypal.core.http.request, {
    apply(target, thisArg, args) {
      const request = args[0] as { method: string; path: string; purpose: string };
      httpCalls.push({ method: request.method, path: request.path, purpose: request.purpose });
      return Reflect.apply(target, thisArg, args);
    },
  });
  const observedDb = new Proxy(t.deps.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return (fn: (tx: Tx) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const result = await fn(tx);
            // This is before PostgreSQL COMMIT, never after it. Actual COMMIT-to-SSE is therefore no larger.
            beforeCommitAt = performance.now();
            return result;
          });
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  timedApp = createApp({
    deps: t.deps,
    static: false,
    health: { db: async () => {}, version: API_VERSION, startedAt: s.clock.now() },
    webhookHandler: createWebhookHandler({
      db: observedDb,
      rail: t.deps.paypal,
      logger: t.deps.logger,
      clock: s.clock,
    }),
  });
  // Buffer signed deliveries while the synthetic mirror is prepared. Batch events are deliberately held:
  // their immediate settle GET would hide a broken webhook success path by applying the item first.
  s.sim.deliverTo(async (request) => {
    deliveries.push(request.clone());
    return new Response("", { status: 200 });
  });
  const fx = await t.fixture({ kind: "judge", members: successCount + 2 });
  workspaceId = fx.workspaceId;
  const senderBatchId = `w1-${randomUUID()}`;
  const [run] = await t.deps.db
    .insert(schema.payRuns)
    .values({
      workspaceId,
      seasonId: fx.seasonId,
      lotId: fx.lotId,
      rateCardId: fx.rateCardId,
      seasonCode: "2026A",
      state: "POSTED",
      currency: "USD",
      rateCardSha256: fx.rateCardSha256,
      batchSha256: "a".repeat(64),
      senderBatchId,
      provenance: "simulated_rail",
    })
    .returning();
  if (!run) throw new Error("W1 fixture run missing");
  runId = run.id;
  runSlug = run.runSlug;
  const receiver = Object.values(JSON.parse(s.env.PP_RECEIVERS ?? "{}") as Record<string, string>)[0];
  if (!receiver) throw new Error("W1 simulator receiver missing");
  const rows = await t.deps.db
    .insert(schema.memberLines)
    .values(
      fx.memberIds.map((memberId) => ({
        workspaceId,
        runId,
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
  const payoutItems = rows.map((_line, i) => ({
    recipient_type: "EMAIL",
    receiver: i === successCount ? s.env.PP_UNCLAIMED_RECEIVER : receiver,
    amount: { currency: "USD", value: "1.00" },
    sender_item_id: `r${run.runSeq}-M-${String(i + 1).padStart(3, "0")}`,
    note: "Simulated PayPal sandbox W1 fixture",
  }));
  const posted = await t.deps.paypal.core.http.request<{ batch_header: { payout_batch_id: string } }>({
    method: "POST",
    path: "/v1/payments/payouts",
    purpose: "payouts.create",
    priority: "live",
    requestId: randomUUID(),
    body: { sender_batch_header: { sender_batch_id: senderBatchId }, items: payoutItems },
  });
  if (!posted.ok) throw new Error(`W1 simulator fixture POST failed: ${posted.status}`);
  const [batch] = await t.deps.db
    .insert(schema.payoutBatches)
    .values({
      workspaceId,
      runId,
      senderBatchId,
      requestId: "b".repeat(64),
      paypalBatchId: posted.body.batch_header.payout_batch_id,
      batchSha256: "a".repeat(64),
      kind: "primary",
      status: "PENDING",
      itemCount: successCount + 2,
      totalCents: BigInt((successCount + 2) * 100),
      currency: "USD",
      provenance: "simulated_rail",
    })
    .returning();
  if (!batch) throw new Error("W1 fixture batch missing");
  await t.deps.db.insert(schema.payoutItems).values(
    rows.map((line, i) => ({
      workspaceId,
      batchId: batch.id,
      lineId: line.id,
      senderItemId: payoutItems[i]?.sender_item_id as string,
      receiver: payoutItems[i]?.receiver as string,
      amountCents: 100n,
      currency: "USD",
      status: "PENDING" as const,
      statusRank: 10,
      provenance: "simulated_rail" as const,
    })),
  );
  token = await t.credentials.frameToken({ workspaceId, role: "treasurer", persona: "analyn" });
  await s.sim.idle();
});

afterAll(async () => {
  try {
    await t?.close();
  } finally {
    await s?.sim.stop();
  }
});

async function itemDeliveries(type: string, duplicate = false) {
  const matched: Request[] = [];
  const seen = new Set<string>();
  for (const d of deliveries) {
    const event = (await d.clone().json()) as { id: string; event_type: string };
    if (event.event_type === `PAYMENT.PAYOUTS-ITEM.${type}`) {
      if (seen.has(event.id) === duplicate) matched.push(d);
      seen.add(event.id);
    }
  }
  return matched;
}

async function nextItem(reader: SseReader, eventId: string) {
  for (;;) {
    const event = RunEvent.parse(JSON.parse((await reader.next(10_000)).data));
    if (event.type === "item.updated" && event.payload.eventId === eventId) return event;
  }
}

async function waitForWebhookTasks() {
  await expect
    .poll(
      async () =>
        t.deps.db
          .select({ id: schema.taskOutbox.id })
          .from(schema.taskOutbox)
          .where(and(eq(schema.taskOutbox.name, "processWebhook"), ne(schema.taskOutbox.state, "done"))),
      { timeout: 10_000, interval: 10 },
    )
    .toEqual([]);
  await t.deps.outbox?.idle();
}

async function statusGets() {
  return httpCalls.filter(
    (call) =>
      call.method === "GET" &&
      (call.path.startsWith("/v1/payments/payouts/") || call.path.startsWith("/v1/payments/payouts-item/")),
  );
}

describe("W1 stored delivery on Simulated PayPal sandbox", () => {
  it("inv.i5.forged-delivery: a forged delivery changes no item, line or ledger", async () => {
    const d = (await itemDeliveries("SUCCEEDED"))[0];
    if (!d) throw new Error("W1 signed success fixture missing");
    const items = await t.deps.db
      .select()
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.workspaceId, workspaceId));
    const lines = await t.deps.db
      .select()
      .from(schema.memberLines)
      .where(eq(schema.memberLines.workspaceId, workspaceId));
    const ledger = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.workspaceId, workspaceId));
    const calls = await statusGets();
    const body = (await d.clone().json()) as Record<string, unknown>;
    const forged = new Request(d.url, {
      method: "POST",
      headers: d.headers,
      body: JSON.stringify({ ...body, id: "WH-W1-FORGED" }),
    });
    expect((await t.app.fetch(forged)).status).toBe(400);
    await waitForWebhookTasks();
    expect(
      await t.deps.db
        .select()
        .from(schema.payoutItems)
        .where(eq(schema.payoutItems.workspaceId, workspaceId)),
    ).toEqual(items);
    expect(
      await t.deps.db
        .select()
        .from(schema.memberLines)
        .where(eq(schema.memberLines.workspaceId, workspaceId)),
    ).toEqual(lines);
    expect(
      await t.deps.db
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.workspaceId, workspaceId)),
    ).toEqual(ledger);
    expect(await statusGets()).toEqual(calls);
    expect(
      await t.deps.db.select().from(schema.taskOutbox).where(eq(schema.taskOutbox.name, "processWebhook")),
    ).toEqual([]);
  });

  it("inv.i5.success-sse: 24 verified successes apply through the production dispatcher to SSE within the timing budget, without GET", async () => {
    const success = (await itemDeliveries("SUCCEEDED")).slice(0, successCount);
    expect(success).toHaveLength(successCount);
    const gets = (await statusGets()).length;
    const { response, reader } = await t.sse(`/v1/runs/${runSlug}/events`, {
      as: t.credentials.bearer(token),
    });
    expect(response.status).toBe(200);
    const latency: number[] = [];
    const wholeDelivery: number[] = [];
    const phases: { dispatch: number; apply: number; sse: number }[] = [];
    try {
      for (const [index, d] of success.entries()) {
        const body = (await d.clone().json()) as { id: string };
        const receiving = nextItem(reader, body.id).then((event) => ({ event, at: performance.now() }));
        const start = performance.now();
        beforeCommitAt = Number.NaN;
        const res = await timedApp.fetch(d.clone());
        expect(res.status).toBe(200);
        const received = await receiving;
        expect(beforeCommitAt).toBeGreaterThan(start);
        // Exercise signature verification, storage, dispatch, item apply and SSE before sampling.
        // Warm-ups still assert the same behavior and absence of GET; the threshold is unchanged.
        if (index >= warmup) {
          latency.push(received.at - beforeCommitAt);
          wholeDelivery.push(received.at - start);
        }
        const times = processingTimes.get(body.id);
        if (times)
          phases.push({
            dispatch: times.started - beforeCommitAt,
            apply: (times.finished ?? received.at) - times.started,
            sse: received.at - (times.finished ?? received.at),
          });
        expect(received.event).toMatchObject({
          type: "item.updated",
          provenance: "simulated_rail",
          runId,
          payload: { from: "PENDING", to: "SUCCESS", source: "webhook" },
        });
      }
    } finally {
      await reader.close();
    }
    await waitForWebhookTasks();
    expect((await statusGets()).length).toBe(gets);
    expect(latency).toHaveLength(count);
    const ordered = latency.toSorted((a, b) => a - b);
    const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1] as number;
    console.info(
      `W1 Simulated PayPal sandbox: n=${latency.length}, before-COMMIT-to-SSE p95=${p95.toFixed(2)} ms; whole-delivery p95=${(wholeDelivery.toSorted((a, b) => a - b)[Math.ceil(wholeDelivery.length * 0.95) - 1] as number).toFixed(2)} ms`,
    );
    console.info("W1 timing phases (ms)", JSON.stringify(phases));
    assertWebhookLatency(p95, process.env.FS_WEBHOOK_PERF === "1");
    expect(s.sim.violations).toEqual([]);
    const stored = await t.deps.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.eventType, "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"));
    expect(stored.filter((e) => e.verified === "self")).toHaveLength(successCount);
    for (const row of stored.filter((e) => e.verified === "self")) {
      expect(row).toMatchObject({
        provenance: "simulated_rail",
        status: "applied",
        receivedAt: s.clock.now(),
        delivery: {
          authAlgo: "SHA256withRSA",
          certWarning: null,
          rejectReason: null,
          transmissionId: expect.any(String),
          transmissionTime: expect.any(String),
          certUrl: expect.any(String),
          transmissionSig: expect.any(String),
        },
      });
    }
  });

  it("inv.i5.duplicates: replayed and reordered successful deliveries add no item update or applied ledger entry", async () => {
    await waitForWebhookTasks();
    // SQL does not promise row order; compare the full snapshots in primary-key order.
    const before = await t.deps.db
      .select()
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.workspaceId, workspaceId), eq(schema.runEvents.type, "item.updated")))
      .orderBy(schema.runEvents.id);
    const ledgerBefore = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, workspaceId),
          eq(schema.ledgerEntries.kind, "webhook.applied"),
        ),
      )
      .orderBy(schema.ledgerEntries.id);
    const [original] = await itemDeliveries("SUCCEEDED");
    if (!original) throw new Error("W1 original success missing");
    // A replay of the SAME transmission is rejected. The simulator's resend copies below have fresh,
    // genuinely signed transmission ids, so event-id deduplication (rather than replay rejection) handles them.
    expect((await t.app.fetch(original.clone())).status).toBe(400);
    for (const d of (await itemDeliveries("SUCCEEDED", true)).slice(0, successCount).reverse())
      expect((await t.app.fetch(d.clone())).status).toBe(200);
    await waitForWebhookTasks();
    const after = await t.deps.db
      .select()
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.workspaceId, workspaceId), eq(schema.runEvents.type, "item.updated")))
      .orderBy(schema.runEvents.id);
    const ledgerAfter = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, workspaceId),
          eq(schema.ledgerEntries.kind, "webhook.applied"),
        ),
      )
      .orderBy(schema.ledgerEntries.id);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(before).toHaveLength(successCount);
  });

  it("inv.i5.non-success-get: a verified non-SUCCEEDED item delivery still makes a fresh GET before changing status", async () => {
    const [unclaimed] = await itemDeliveries("UNCLAIMED");
    if (!unclaimed) throw new Error("W1 signed unclaimed fixture missing");
    const body = (await unclaimed.clone().json()) as { id: string };
    const gets = (await statusGets()).length;
    const [last] = await t.deps.db
      .select({ id: schema.runEvents.id })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.workspaceId, workspaceId))
      .orderBy(desc(schema.runEvents.id))
      .limit(1);
    const { reader } = await t.sse(`/v1/runs/${runSlug}/events`, {
      as: t.credentials.bearer(token),
      headers: { "last-event-id": String(last?.id ?? 0) },
    });
    try {
      const receiving = nextItem(reader, body.id);
      expect((await t.app.fetch(unclaimed.clone())).status).toBe(200);
      expect(await receiving).toMatchObject({
        type: "item.updated",
        provenance: "simulated_rail",
        payload: { from: "PENDING", to: "UNCLAIMED", source: "status_check" },
      });
      expect((await statusGets()).length).toBe(gets + 1);
      await waitForWebhookTasks();
    } finally {
      await reader.close();
    }
  });

  it("inv.i5.locked-identity: a payout identity bound between resolution and the locked apply is revalidated", async () => {
    // Separate DB clone and no dispatcher: the fallback stays queued so this test observes the webhook
    // transaction itself, without a legitimate later settle GET changing the fixture underneath it.
    const isolated = await startSimApp(s, { db: "postgres" });
    try {
      const original = (await itemDeliveries("SUCCEEDED"))[successCount];
      const [unclaimed] = await itemDeliveries("UNCLAIMED");
      if (!original || !unclaimed) throw new Error("W1 race deliveries missing");
      const raw = await original.clone().text();
      const event = JSON.parse(raw) as {
        id: string;
        event_type: string;
        resource: {
          payout_item_id: string;
          payout_batch_id: string;
          payout_item: { sender_item_id: string; receiver: string };
        };
      };
      const competing = (await unclaimed.clone().json()) as { resource: { payout_item_id: string } };
      const fx = await isolated.fixture({ kind: "judge", members: 1 });
      const senderBatchId = `w1-race-${randomUUID()}`;
      const [run] = await isolated.deps.db
        .insert(schema.payRuns)
        .values({
          workspaceId: fx.workspaceId,
          seasonId: fx.seasonId,
          lotId: fx.lotId,
          rateCardId: fx.rateCardId,
          seasonCode: "2026A",
          state: "POSTED",
          currency: "USD",
          rateCardSha256: fx.rateCardSha256,
          batchSha256: "c".repeat(64),
          senderBatchId,
          provenance: "simulated_rail",
        })
        .returning();
      if (!run) throw new Error("W1 race run missing");
      const [line] = await isolated.deps.db
        .insert(schema.memberLines)
        .values({
          workspaceId: fx.workspaceId,
          runId: run.id,
          memberId: fx.memberIds[0] as string,
          state: "PAYPAL_PENDING",
          rail: "ON",
          currency: "USD",
          verifiedG: 1000n,
          grade1G: 0n,
          premiumCents: 100n,
          bonusCents: 0n,
          deductionsCents: 0n,
          creditsCents: 0n,
          netCents: 100n,
          deductions: [],
          provenance: "simulated_rail",
        })
        .returning();
      if (!line) throw new Error("W1 race line missing");
      const [batch] = await isolated.deps.db
        .insert(schema.payoutBatches)
        .values({
          workspaceId: fx.workspaceId,
          runId: run.id,
          senderBatchId,
          requestId: "d".repeat(64),
          paypalBatchId: event.resource.payout_batch_id,
          batchSha256: "c".repeat(64),
          kind: "primary",
          status: "PENDING",
          itemCount: 1,
          totalCents: 100n,
          currency: "USD",
          provenance: "simulated_rail",
        })
        .returning();
      if (!batch) throw new Error("W1 race batch missing");
      const [item] = await isolated.deps.db
        .insert(schema.payoutItems)
        .values({
          workspaceId: fx.workspaceId,
          batchId: batch.id,
          lineId: line.id,
          senderItemId: event.resource.payout_item.sender_item_id,
          receiver: event.resource.payout_item.receiver,
          amountCents: 100n,
          currency: "USD",
          status: "PENDING",
          statusRank: 10,
          provenance: "simulated_rail",
        })
        .returning();
      if (!item) throw new Error("W1 race item missing");
      const [stored] = await isolated.deps.db
        .insert(schema.webhookEvents)
        .values({
          paypalEventId: event.id,
          eventType: event.event_type,
          verified: "self",
          raw,
          status: "received",
          receivedAt: s.clock.now(),
          provenance: "simulated_rail",
          delivery: {
            transmissionId: original.headers.get("paypal-transmission-id"),
            transmissionTime: original.headers.get("paypal-transmission-time"),
            transmissionSig: original.headers.get("paypal-transmission-sig"),
            certUrl: original.headers.get("paypal-cert-url"),
            authAlgo: original.headers.get("paypal-auth-algo"),
            certWarning: null,
            rejectReason: null,
          },
        })
        .returning();
      if (!stored) throw new Error("W1 race stored event missing");
      const ledgerBefore = await isolated.deps.db.select().from(schema.ledgerEntries);
      let rebound = false;
      const raceDb: Db = new Proxy(isolated.deps.db, {
        get(target, key, receiver) {
          if (key === "transaction")
            return async (...args: Parameters<Db["transaction"]>) => {
              if (!rebound) {
                rebound = true;
                await target
                  .update(schema.payoutItems)
                  .set({ payoutItemId: competing.resource.payout_item_id })
                  .where(eq(schema.payoutItems.id, item.id));
              }
              return target.transaction(...args);
            };
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await processWebhook(
        { ...isolated.deps, db: raceDb },
        { webhookEventId: stored.id, paypalEventId: event.id },
        { complete: async () => {} },
      );
      expect(rebound).toBe(true);
      const [notice] = await isolated.deps.db
        .select()
        .from(schema.webhookEvents)
        .where(eq(schema.webhookEvents.id, stored.id));
      expect(notice).toMatchObject({ status: "orphan", appliedAt: null });
      const [held] = await isolated.deps.db
        .select()
        .from(schema.payoutItems)
        .where(eq(schema.payoutItems.id, item.id));
      expect(held).toMatchObject({
        status: "PENDING",
        statusRank: 10,
        payoutItemId: competing.resource.payout_item_id,
      });
      expect(
        await isolated.deps.db.select().from(schema.memberLines).where(eq(schema.memberLines.id, line.id)),
      ).toEqual([line]);
      expect(await isolated.deps.db.select().from(schema.ledgerEntries)).toEqual(ledgerBefore);
      const fallback = await isolated.deps.db
        .select()
        .from(schema.taskOutbox)
        .where(eq(schema.taskOutbox.name, "settleBatch"));
      expect(fallback).toEqual([
        expect.objectContaining({ state: "queued", args: expect.objectContaining({ batchId: batch.id }) }),
      ]);
    } finally {
      await isolated.close();
    }
  });

  it("inv.i5.stale-delivery: an authentic but six-minute-old delivery cannot pay its still-pending item", async () => {
    // The extra success was never submitted to fs-api. Keep its original signed body AND headers:
    // advancing the verifier's clock tests actual freshness rather than tampering with a timestamp.
    const stale = (await itemDeliveries("SUCCEEDED"))[successCount];
    if (!stale) throw new Error("W1 withheld signed success fixture missing");
    const body = (await stale.clone().json()) as { resource: { payout_item: { sender_item_id: string } } };
    const senderItemId = body.resource.payout_item.sender_item_id;
    const before = await t.deps.db
      .select()
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.senderItemId, senderItemId));
    expect(before[0]?.status).toBe("PENDING");
    const ledger = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.workspaceId, workspaceId));
    const calls = await statusGets();
    await waitForWebhookTasks();
    s.clock.advance(6 * 60_000);
    expect((await t.app.fetch(stale.clone())).status).toBe(400);
    await waitForWebhookTasks();
    expect(
      await t.deps.db
        .select()
        .from(schema.payoutItems)
        .where(eq(schema.payoutItems.senderItemId, senderItemId)),
    ).toEqual(before);
    expect(
      await t.deps.db
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.workspaceId, workspaceId)),
    ).toEqual(ledger);
    expect(await statusGets()).toEqual(calls);
  });

  it("inv.i7.append-only-history: the webhook path retains fs_app's append-only run_events and ledger_entries privileges", async () => {
    if (!t.pg) throw new Error("W1 Postgres missing");
    const rows = await t.pg.app.sql`
      select current_user as role,
        has_table_privilege(current_user, 'run_events', 'UPDATE') as events_update,
        has_table_privilege(current_user, 'run_events', 'DELETE') as events_delete,
        has_table_privilege(current_user, 'ledger_entries', 'UPDATE') as ledger_update,
        has_table_privilege(current_user, 'ledger_entries', 'DELETE') as ledger_delete`;
    expect(rows[0]).toEqual({
      role: "fs_app",
      events_update: false,
      events_delete: false,
      ledger_update: false,
      ledger_delete: false,
    });
  });
});
