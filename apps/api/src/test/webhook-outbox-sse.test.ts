// Integration on embedded Postgres: PayPal webhook → verified → stored + enqueued in one transaction (I7) →
// the outbox dispatcher runs processWebhook → appendEvent + NOTIFY → the LISTEN bus → SSE (S3.7), labelled
// with the rail's provenance (I8). The processWebhook handler here is a stand-in for the runs slice's.
import { randomUUID } from "node:crypto";
import { RunEvent } from "@fairsplit/contracts";
import { appendEvent, schema } from "@fairsplit/db";
import type { FixtureWorkspace } from "@fairsplit/db/testing";
import type { TaskHandler } from "@fairsplit/outbox";
import {
  createTestPki,
  payoutItemResource,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
} from "@fairsplit/paypal-core/testing";
import { eq, sql } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness.js";
import { createPayPalMock } from "./paypal.js";

const pki = createTestPki();
const leaf = pki.issueLeaf();
const paypal = createPayPalMock([http.get(TEST_CERT_URL, () => new HttpResponse(leaf.pem))]);

let t: TestApp;
let fx: FixtureWorkspace;
let runSlug: string;
let token: string;

const processWebhook: TaskHandler = async (args, ctx) => {
  const webhookEventId = String(args.webhookEventId);
  await t.deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.webhookEvents)
      .set({ workspaceId: fx.workspaceId, status: "applied", appliedAt: new Date() })
      .where(eq(schema.webhookEvents.id, webhookEventId))
      .returning();
    if (!row) throw new Error("webhook row missing");
    await appendEvent(tx, {
      workspaceId: fx.workspaceId,
      runId: fx.runId,
      type: "webhook.received",
      actor: { kind: "paypal", id: "paypal:webhook" },
      provenance: row.provenance as "live",
      payload: {
        webhookEventId,
        paypalEventId: String(args.paypalEventId),
        eventType: row.eventType,
        verified: row.verified ?? "self",
        duplicate: false,
      },
    });
    await ctx.complete(tx);
  });
};

function delivery(event: object, transmissionId = randomUUID()) {
  return signWebhook({
    body: event,
    privateKey: leaf.privateKey,
    webhookId: TEST_WEBHOOK_ID,
    transmissionId,
    transmissionTime: t.clock
      .now()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
  });
}

function itemEvent(seed: string) {
  return syntheticEvent(
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    payoutItemResource({
      payoutItemId: `PIT${seed.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
      senderItemId: "r37-M-014",
      payoutBatchId: "PB2026A37",
      transactionStatus: "SUCCESS",
    }),
    seed,
  ) as { id: string };
}

beforeAll(async () => {
  paypal.start();
  t = await createTestApp({
    db: "postgres",
    dispatcher: true,
    clock: new Date(),
    env: {
      PP_MODE: "sandbox",
      PP_CLIENT_ID: "test-client",
      PP_CLIENT_SECRET: "test-secret",
      PP_WEBHOOK_ID: TEST_WEBHOOK_ID,
    },
    webhookTrustAnchors: [pki.ca.pem],
    taskHandlers: { processWebhook },
  });
  fx = await t.fixture({ withRun: true, kind: "judge" });
  const [run] = await t.deps.db
    .select({ slug: schema.payRuns.runSlug })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, fx.runId as string));
  runSlug = run?.slug as string;
  token = await t.credentials.frameToken({
    workspaceId: fx.workspaceId,
    role: "treasurer",
    persona: "analyn",
  });
});

afterAll(async () => {
  await t?.close();
  paypal.stop();
});

describe("webhook → outbox → SSE on Postgres", () => {
  it("a verified delivery reaches the run's SSE stream as an IC-01 envelope, labelled with its rail", async () => {
    const { reader } = await t.sse(`/v1/runs/${runSlug}/events`, { as: t.credentials.bearer(token) });
    const first = reader.next(10_000);
    const event = itemEvent("first");
    const d = delivery(event);
    const sent = performance.now();
    const res = await t.request("/webhooks/paypal", { method: "POST", body: d.body, headers: d.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fs-rail")).toBe("sandbox");
    const m = await first;
    const latencyMs = performance.now() - sent;
    const envelope = RunEvent.parse(JSON.parse(m.data));
    expect(envelope).toMatchObject({
      type: "webhook.received",
      ws: fx.workspaceId,
      runId: fx.runId,
      provenance: "live",
      actor: { kind: "paypal", id: "paypal:webhook", impersonatedBy: null },
      payload: {
        paypalEventId: event.id,
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        verified: "self",
        duplicate: false,
      },
    });
    expect(m.id).toBe(envelope.id);
    expect(latencyMs).toBeLessThan(5_000);
    await reader.close();
  });

  it("inv.i7.outbox: the event row and its processWebhook task are written together, the task deduplicated", async () => {
    const event = itemEvent("i7");
    const d = delivery(event);
    expect(
      (await t.request("/webhooks/paypal", { method: "POST", body: d.body, headers: d.headers })).status,
    ).toBe(200);
    await t.deps.outbox?.idle();
    const [row] = await t.deps.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.paypalEventId, event.id));
    expect(row).toMatchObject({ verified: "self", provenance: "live" });
    const tasks = await t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.dedupeKey, `wh:${event.id}`));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.args).toEqual({ webhookEventId: row?.id, paypalEventId: event.id });
  });

  it("inv.i7.outbox: when the enqueue fails, the event is not stored either (PayPal retries)", async () => {
    const event = itemEvent("i7-fail");
    await t.pg?.owner.sql.unsafe(`
      create or replace function fs_test_fail_outbox() returns trigger language plpgsql as $$
      begin
        if new.args->>'paypalEventId' = '${event.id}' then raise exception 'injected outbox failure'; end if;
        return new;
      end $$;
      create trigger fs_test_fail_outbox before insert on task_outbox for each row execute function fs_test_fail_outbox();`);
    try {
      const d = delivery(event);
      const res = await t.request("/webhooks/paypal", { method: "POST", body: d.body, headers: d.headers });
      expect(res.status).toBe(500);
      const rows = await t.deps.db
        .select()
        .from(schema.webhookEvents)
        .where(eq(schema.webhookEvents.paypalEventId, event.id));
      expect(rows).toHaveLength(0);
    } finally {
      await t.pg?.owner.sql.unsafe(
        "drop trigger fs_test_fail_outbox on task_outbox; drop function fs_test_fail_outbox();",
      );
    }
  });

  it("a resent duplicate is acknowledged once and announced as a duplicate; Last-Event-ID replays it", async () => {
    const event = itemEvent("dup");
    const { reader } = await t.sse(`/v1/workspaces/${fx.workspaceId}/events`, {
      as: t.credentials.bearer(token),
    });
    const applied = reader.next(10_000);
    const firstDelivery = delivery(event);
    expect(
      (
        await t.request("/webhooks/paypal", {
          method: "POST",
          body: firstDelivery.body,
          headers: firstDelivery.headers,
        })
      ).status,
    ).toBe(200);
    const original = RunEvent.parse(JSON.parse((await applied).data));
    expect(original.payload).toMatchObject({ paypalEventId: event.id, duplicate: false });
    const after = Number(original.id);

    const next = reader.next(10_000);
    const again = delivery(event);
    expect(
      (await t.request("/webhooks/paypal", { method: "POST", body: again.body, headers: again.headers }))
        .status,
    ).toBe(200);
    const dup = RunEvent.parse(JSON.parse((await next).data));
    expect(dup).toMatchObject({
      type: "webhook.received",
      payload: { paypalEventId: event.id, duplicate: true },
    });
    await reader.close();
    const tasks = await t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.dedupeKey, `wh:${event.id}`));
    expect(tasks).toHaveLength(1);

    const replay = await t.sse(`/v1/runs/${runSlug}/events`, {
      as: t.credentials.bearer(token),
      headers: { "last-event-id": String(after) },
    });
    // the duplicate notice carries no runId, so the run stream skips it: nothing newer for this run
    await expect(replay.reader.next(300)).rejects.toThrow(/no message/);
    await replay.reader.close();
    const ws = await t.sse(`/v1/workspaces/${fx.workspaceId}/events`, {
      as: t.credentials.bearer(token),
      headers: { "last-event-id": String(after) },
    });
    expect(RunEvent.parse(JSON.parse((await ws.reader.next(5_000)).data)).payload).toMatchObject({
      duplicate: true,
    });
    await ws.reader.close();
  });

  it("a forged delivery is refused (400), kept as a rejected row with its provenance, and enqueues nothing", async () => {
    const event = itemEvent("forged");
    const d = delivery(event);
    const res = await t.request("/webhooks/paypal", {
      method: "POST",
      body: d.body.replace("SUCCESS", "SUCCESS "),
      headers: d.headers,
    });
    expect(res.status).toBe(400);
    const rejected = await t.deps.db
      .select()
      .from(schema.webhookEvents)
      .where(sql`${schema.webhookEvents.status} = 'rejected' and ${schema.webhookEvents.verified} is null`);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((r) => r.provenance === "live")).toBe(true);
    const tasks = await t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.dedupeKey, `wh:${event.id}`));
    expect(tasks).toHaveLength(0);
  });

  it("the run stream is scoped to the credential's workspace", async () => {
    const other = await t.fixture({ withRun: true });
    const [run] = await t.deps.db
      .select({ slug: schema.payRuns.runSlug })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, other.runId as string));
    const r = await t.json(`/v1/runs/${run?.slug}/events`, { as: t.credentials.bearer(token) });
    expect(r.status).toBe(404);
    const line = await t.json(`/v1/lines/${randomUUID()}/events`, { as: t.credentials.bearer(token) });
    expect(line.status).toBe(404);
  });

  it("/readyz is ready with the database, the LISTEN round-trip and the dispatcher", async () => {
    const r = await t.json<{ status: string; checks: Record<string, { ok: boolean }> }>("/readyz");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ready");
    expect(r.body.checks.db?.ok && r.body.checks.listen?.ok && r.body.checks.dispatcher?.ok).toBe(true);
    const h = await t.json<{ status: string; rail: string }>("/healthz");
    expect(h).toMatchObject({ status: 200, body: { status: "ok", rail: "sandbox" } });
  });
});
