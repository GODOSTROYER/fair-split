/**
 * Rows that must outlive a Judge workspace (review major, paypal.ts). Judge workspaces are purged hourly and the
 * Reset button expires one at once, but three tables are global memory that only happens to name a workspace:
 *
 * - `paypal_calls` is the limiter's 60 s window and its 6-minute 429 circuit (the sandbox blocks the IP above 50/min);
 * - `webhook_events` is the event-id dedupe record (a resent duplicate must stay a duplicate);
 * - `llm_calls` is the ClaudeGateway's spend meter (judge_read is capped per day).
 *
 * All three reference workspaces ON DELETE SET NULL, and fs_app may not delete them.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLimiter } from "../src/limiter.js";
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

/** What the Reset button and the hourly judgeReset do: expire the workspace, then purge it. */
async function expireAndPurge(workspaceId: string): Promise<void> {
  await t.app.db
    .update(workspaces)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(workspaces.id, workspaceId));
  const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${workspaceId}) as ok`;
  expect(res?.ok).toBe(true);
  expect(await t.owner.db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).toHaveLength(0);
}

describe("a purge keeps the limiter's memory (paypal_calls ON DELETE SET NULL)", () => {
  it("a 429 recorded against judge workspace W keeps the circuit open after W is expired and purged", async () => {
    const w = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const limiter = createLimiter(t.app.db);
    const g = await limiter.take({ ...live, workspaceId: w.workspaceId });
    if (!g.ok) throw new Error("expected a grant");
    await limiter.record(g.callId, { status: 429, ms: 40, debugId: "f2f3a1b0c9d8e" });
    await expireAndPurge(w.workspaceId);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "CIRCUIT_OPEN" });
    const [row] = await t.owner.db.select().from(paypalCalls).where(eq(paypalCalls.id, g.callId));
    expect(row).toMatchObject({ status: 429, workspaceId: null, debugId: "f2f3a1b0c9d8e" });
  });

  it("slots a purged workspace spent still count against the 60 s window", async () => {
    const w = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const limiter = createLimiter(t.app.db, { perWindow: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await limiter.take({ ...live, workspaceId: w.workspaceId })).ok).toBe(true);
    }
    await expireAndPurge(w.workspaceId);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "WINDOW_FULL" });
    expect((await limiter.state()).inWindow).toBe(3);
  });
});

describe("a purge keeps webhook dedupe and AI spend", () => {
  it("a purged workspace's webhook event stays, so PayPal's resent duplicate is still a duplicate", async () => {
    const w = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const event = {
      paypalEventId: "WH-7Y7254563A4550640-11V2185806837105M",
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      verified: "self" as const,
      raw: '{"id":"WH-7Y7254563A4550640-11V2185806837105M"}',
      status: "applied" as const,
      provenance: "simulated_rail" as const,
    };
    await t.app.db.insert(webhookEvents).values({ ...event, workspaceId: w.workspaceId });
    await expireAndPurge(w.workspaceId);
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
    const w = await fixtureWorkspace(t.app.db, { kind: "judge" });
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
    await expireAndPurge(w.workspaceId);
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
