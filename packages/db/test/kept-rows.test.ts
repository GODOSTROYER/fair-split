/**
 * Rows that must outlive a Judge workspace (review major, paypal.ts). The hourly judgeReset purges every judge
 * workspace whose expiry has passed, but three tables are global memory that only happens to name a workspace:
 *
 * - `paypal_calls` is the limiter's 60 s window and its 6-minute 429 circuit (the sandbox blocks the IP above 50/min);
 * - `webhook_events` is the event-id dedupe record (a resent duplicate must stay a duplicate);
 * - `llm_calls` is the ClaudeGateway's spend meter (judge_read is capped per day).
 *
 * All three reference workspaces ON DELETE SET NULL, and fs_app may not delete them.
 *
 * Retention (review minor, 0005: nothing pruned them, so they grew without bound): the owner-side
 * fs_prune_kept_rows() (migrations/0016, `pruneKeptRows`), which fs_app may call from the cron, drops paypal_calls
 * older than a day at least (the limiter needs 60 s, the circuit 6 minutes, /ops a day), resolved webhook events
 * older than 30 days at least (the event-id dedupe outlasts PayPal's 3 days of retries, resends and catch-up),
 * rejected ones after 7 days (S3.9), and never a received (unprocessed) event or an llm_calls row (the replay store).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLimiter } from "../src/limiter.js";
import { KEPT_ROWS_FLOORS, pruneKeptRows } from "../src/retention.js";
import { llmCalls, paypalCalls, webhookEvents, workspaces } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { sqlState } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
beforeEach(async () => {
  await t.owner.db.delete(paypalCalls);
});
afterAll(async () => {
  await t?.close();
});

const live = { purpose: "toolkit:create_invoice", priority: "live" as const };

/**
 * A judge workspace whose expiry has passed (an expiry never moves earlier, migrations/0009, so the fixture is
 * created with one already past: its 24 h are over).
 */
const expiredJudge = () =>
  fixtureWorkspace(t.app.db, { kind: "judge", expiresAt: new Date(Date.now() - 1000) });

/** What the hourly judgeReset does with it: purge it. */
async function purge(workspaceId: string): Promise<void> {
  const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${workspaceId}) as ok`;
  expect(res?.ok).toBe(true);
  expect(await t.owner.db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).toHaveLength(0);
}

describe("a purge keeps the limiter's memory (paypal_calls ON DELETE SET NULL)", () => {
  it("a 429 recorded against judge workspace W keeps the circuit open after W is purged", async () => {
    const w = await expiredJudge();
    const limiter = createLimiter(t.app.db);
    const g = await limiter.take({ ...live, workspaceId: w.workspaceId });
    if (!g.ok) throw new Error("expected a grant");
    await limiter.record(g.callId, { status: 429, ms: 40, debugId: "f2f3a1b0c9d8e" });
    await purge(w.workspaceId);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "CIRCUIT_OPEN" });
    const [row] = await t.owner.db.select().from(paypalCalls).where(eq(paypalCalls.id, g.callId));
    expect(row).toMatchObject({ status: 429, workspaceId: null, debugId: "f2f3a1b0c9d8e" });
  });

  it("slots a purged workspace spent still count against the 60 s window", async () => {
    const w = await expiredJudge();
    const limiter = createLimiter(t.app.db, { perWindow: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await limiter.take({ ...live, workspaceId: w.workspaceId })).ok).toBe(true);
    }
    await purge(w.workspaceId);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "WINDOW_FULL" });
    expect((await limiter.state()).inWindow).toBe(3);
  });
});

describe("a purge keeps webhook dedupe and AI spend", () => {
  it("a purged workspace's webhook event stays, so PayPal's resent duplicate is still a duplicate", async () => {
    const w = await expiredJudge();
    const event = {
      paypalEventId: "WH-7Y7254563A4550640-11V2185806837105M",
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      verified: "self" as const,
      raw: '{"id":"WH-7Y7254563A4550640-11V2185806837105M"}',
      status: "applied" as const,
      provenance: "simulated_rail" as const,
    };
    await t.app.db.insert(webhookEvents).values({ ...event, workspaceId: w.workspaceId });
    await purge(w.workspaceId);
    const [kept] = await t.owner.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.paypalEventId, event.paypalEventId));
    expect(kept).toMatchObject({ workspaceId: null, status: "applied" });
    const again = await t.app.db
      .insert(webhookEvents)
      .values({ ...event, status: "received" })
      .onConflictDoNothing({ target: webhookEvents.paypalEventId })
      .returning();
    expect(again).toHaveLength(0);
  });

  it("a purged workspace's Claude spend still counts against the day's budget", async () => {
    const w = await expiredJudge();
    await t.app.db.insert(llmCalls).values({
      workspaceId: w.workspaceId,
      cacheKey: "a".repeat(64),
      purpose: "read_slip_live",
      budgetKey: "judge_read",
      model: "claude-opus-5-5",
      effort: "low",
      promptV: "read.v1",
      costMicros: 412_000n,
      provenance: "live",
    });
    await purge(w.workspaceId);
    const [spent] = await t.app.db
      .select({ micros: sql<string>`coalesce(sum(${llmCalls.costMicros}), 0)::text` })
      .from(llmCalls)
      .where(
        and(eq(llmCalls.budgetKey, "judge_read"), sql`${llmCalls.createdAt} >= date_trunc('day', now())`),
      );
    expect(spent?.micros).toBe("412000");
  });
});

describe("fs_app cannot erase them either", () => {
  it("has no DELETE or TRUNCATE on paypal_calls, webhook_events or llm_calls", async () => {
    for (const table of ["paypal_calls", "webhook_events", "llm_calls"]) {
      for (const priv of ["DELETE", "TRUNCATE"]) {
        const [row] = await t.app.sql<{ ok: boolean }[]>`
          select has_table_privilege(current_user, ${table}, ${priv}) as ok`;
        expect(row?.ok, `${table} ${priv}`).toBe(false);
      }
    }
    expect(await sqlState(() => t.app.sql`delete from paypal_calls`)).toBe("42501");
    // the limiter itself only inserts and completes rows
    const limiter = createLimiter(t.app.db);
    const g = await limiter.take(live);
    if (!g.ok) throw new Error("expected a grant");
    await limiter.record(g.callId, { status: 201, ms: 300 });
  });
});

describe("retention: fs_prune_kept_rows keeps what the limiter, the dedupe and the replay store need", () => {
  const DAY = 86_400_000;
  /** a paypal_calls row granted `ago` ms ago */
  const callAt = async (ago: number, status = 200) => {
    const [row] = await t.owner.db
      .insert(paypalCalls)
      .values({
        purpose: "seed",
        priority: "live",
        status,
        at: sql`clock_timestamp() - make_interval(secs => ${ago / 1000})`,
        respondedAt: sql`clock_timestamp() - make_interval(secs => ${ago / 1000})`,
      })
      .returning({ id: paypalCalls.id });
    return row?.id ?? "";
  };
  let n = 0;
  /** a webhook_events row received `ago` ms ago */
  const eventAt = async (ago: number, status: "received" | "applied" | "orphan" | "rejected") => {
    const id = `WH-RETAIN-${++n}-${Date.now()}`;
    await t.owner.db.insert(webhookEvents).values({
      paypalEventId: id,
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      verified: status === "rejected" ? null : "self",
      raw: "{}",
      status,
      receivedAt: sql`now() - make_interval(secs => ${ago / 1000})`,
      createdAt: sql`now() - make_interval(secs => ${ago / 1000})`,
      provenance: "live",
    });
    return id;
  };
  const callExists = async (id: string) =>
    (await t.owner.db.select().from(paypalCalls).where(eq(paypalCalls.id, id))).length === 1;
  const eventExists = async (id: string) =>
    (await t.owner.db.select().from(webhookEvents).where(eq(webhookEvents.paypalEventId, id))).length === 1;

  it("uses the floors the limiter and the dedupe need", () => {
    expect(KEPT_ROWS_FLOORS).toEqual({
      paypalCallsHours: 24,
      webhookEventsHours: 30 * 24,
      rejectedEventsHours: 24,
    });
  });

  it("fs_app prunes old paypal_calls through it but never the last day, so the window and the 429 circuit survive", async () => {
    const fresh429 = await callAt(60_000, 429);
    const hourOld = await callAt(3_600_000);
    const twoDays = await callAt(2 * DAY);
    const old = await callAt(31 * DAY);
    // defaults: 30 days
    expect((await pruneKeptRows(t.app.db)).paypalCalls).toBe(1);
    expect(await callExists(old)).toBe(false);
    expect(await callExists(twoDays)).toBe(true);
    // asking for one minute is held at the one-day floor
    expect((await pruneKeptRows(t.app.db, { paypalCallsHours: 1 / 60 })).paypalCalls).toBe(1);
    expect(await callExists(twoDays)).toBe(false);
    expect(await callExists(hourOld)).toBe(true);
    expect(await callExists(fresh429)).toBe(true);
    expect(await createLimiter(t.app.db).take(live)).toMatchObject({ ok: false, reason: "CIRCUIT_OPEN" });
    // and the SQL function holds the floor for a raw caller too
    const [raw] = await t.app.sql<{ pruned_calls: string }[]>`
      select pruned_calls::text from fs_prune_kept_rows(interval '0 seconds', interval '0 seconds', interval '0 seconds')`;
    expect(raw?.pruned_calls).toBe("0");
    expect(await callExists(hourOld)).toBe(true);
  });

  it("webhook events: resolved ones go after 30 days at least, rejected ones after 7 days, received ones never", async () => {
    const received = await eventAt(400 * DAY, "received");
    const applied40 = await eventAt(40 * DAY, "applied");
    const orphan40 = await eventAt(40 * DAY, "orphan");
    const applied20 = await eventAt(20 * DAY, "applied");
    const rejected8 = await eventAt(8 * DAY, "rejected");
    const rejected2 = await eventAt(2 * DAY, "rejected");
    const r = await pruneKeptRows(t.app.db, { webhookEventsHours: 1 }); // held at the 30-day floor
    expect(r).toMatchObject({ webhookEvents: 2, rejectedEvents: 1 });
    expect(await eventExists(received)).toBe(true);
    expect(await eventExists(applied40)).toBe(false);
    expect(await eventExists(orphan40)).toBe(false);
    expect(await eventExists(applied20)).toBe(true);
    expect(await eventExists(rejected8)).toBe(false);
    expect(await eventExists(rejected2)).toBe(true);
    expect((await pruneKeptRows(t.app.db, { rejectedEventsHours: 1 })).rejectedEvents).toBe(1);
    expect(await eventExists(rejected2)).toBe(false);
  });

  it("never prunes llm_calls, the Judge replay store", async () => {
    await t.owner.db.insert(llmCalls).values({
      cacheKey: "c".repeat(64),
      purpose: "read_slip",
      budgetKey: "daily",
      model: "claude-opus-5-5",
      effort: "low",
      promptV: "read.v1",
      costMicros: 1n,
      provenance: "live",
      createdAt: sql`now() - interval '400 days'`,
    });
    await pruneKeptRows(t.app.db);
    const [row] = await t.owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(llmCalls)
      .where(eq(llmCalls.cacheKey, "c".repeat(64)));
    expect(row?.n).toBe(1);
  });

  it("is the only way fs_app removes them: PUBLIC cannot call it and fs_app still cannot DELETE", async () => {
    const [grants] = await t.owner.sql<{ app: boolean; pub: boolean }[]>`
      select has_function_privilege('fs_app', 'fs_prune_kept_rows(interval, interval, interval)', 'EXECUTE') as app,
             exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where p.proname = 'fs_prune_kept_rows' and a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub`;
    expect(grants).toEqual({ app: true, pub: false });
    expect(await sqlState(() => t.app.sql`delete from webhook_events`)).toBe("42501");
  });
});
