// C-21 counts a co-op's own primary batch by when it reaches PayPal (S3.6.4, register C-21; round 4, M5), on embedded
// Postgres with PayPal answered by msw. The service checks C-21's 40 live batches a day only at a batch's first write,
// and outside Judge Mode no slot counts a resumed POST. So a written primary batch whose POST was paced and that
// resumes more than a lane lease later (an outage, a kill switch held for a day) is checked again before it goes out
// (under the spend lock) and counted from then (a `batch_sent` mark in the system ledger), as a re-route is (D7):
// while the day is full it waits (nothing sent, the rows kept), and once it posts it weighs on C-21 for the 24 h after
// that POST although its rows were written two days before. A showcase workspace (a co-op's own): no judge quota.
import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_QUOTA } from "../judge/index.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";
import { postsInLast24h } from "./payouts.js";

const POSTS = `${PAYPAL_SANDBOX}/v1/payments/payouts`;
const H = 3_600_000;
const script = paypalScript();
let h: RunsHarness;
const sent: { at: number; sbid: string }[] = [];

async function batch() {
  const [b] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(and(eq(schema.payoutBatches.runId, h.world.runId), eq(schema.payoutBatches.kind, "primary")));
  return b;
}

async function runState() {
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

/** The post's waiting attempt rows are due now (the outbox's schedule is the database's clock). */
async function dueNow() {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

async function queuedPosts(): Promise<number> {
  const rows = await h.t.deps.db
    .select({ id: schema.taskOutbox.id })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
  return rows.length;
}

/** The `batch_sent` marks of a batch (only the C-21 guard's locked path writes one). */
async function sentMarks(batchId: string): Promise<number> {
  const [row] = (await h.t.deps.db.execute(sql`
    select count(*)::int as n from reconciliation_reports
     where kind = 'balance' and workspace_id is null
       and summary->>'entry' = 'batch_sent' and summary->>'batchId' = ${batchId}`)) as unknown as {
    n: number;
  }[];
  return Number(row?.n ?? 0);
}

/** A co-op's other workspace posts C-21's 40 an hour ago (live batches on the sandbox rail). */
async function fillC21() {
  const owner = h.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  const other = await h.t.fixture({ kind: "real", withRun: true });
  const at = new Date(h.t.clock.nowMs() - H);
  for (let i = 0; i < JUDGE_QUOTA.dailyMax; i++) {
    await owner.insert(schema.payoutBatches).values({
      workspaceId: other.workspaceId,
      runId: other.runId as string,
      senderBatchId: `2026A-c21p-${randomUUID()}`,
      requestId: "a".repeat(64),
      batchSha256: "b".repeat(64),
      kind: "primary",
      status: "SUCCESS",
      itemCount: 8,
      totalCents: 36_839n,
      currency: "USD",
      provenance: "live",
      submittedAt: at,
    });
  }
}

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
  h.paypal?.use(
    http.post(POSTS, async ({ request }) => {
      const body = (await request.clone().json()) as PostedBatch;
      sent.push({ at: h.t.clock.nowMs(), sbid: body.sender_batch_header.sender_batch_id });
    }),
  );
  await resolveAll(h);
  await signBoth(h);
  // PayPal paces the POST after the rows are written: the post waits as its press's next attempt row
  h.paypal?.use(http.post(POSTS, () => paypalError(429, "RATE_LIMIT_REACHED"), { once: true }));
  await runQueued(h, "postPayoutBatch");
  expect(await batch()).toMatchObject({ status: "SUBMITTED", paypalBatchId: null, provenance: "live" });
  expect(await runState()).toBe("POSTING");
  expect(sent).toHaveLength(0);
  // an outage outlasts the day: the written rows still wait 25 h on
  h.t.clock.advance(25 * H);
});
afterAll(async () => h?.close());

describe("a co-op's primary batch resumed after a day answers to C-21 at its POST and is counted from it", () => {
  it("its write is out of C-21's window; the day is full (40): the resume waits, nothing is sent", async () => {
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
    await fillC21();
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(JUDGE_QUOTA.dailyMax);
    await dueNow();
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(0);
    const b = await batch();
    expect(b).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
    expect(await sentMarks(b?.id as string)).toBe(0);
    expect(await runState()).toBe("POSTING");
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(JUDGE_QUOTA.dailyMax);
    // it waits as its press's next attempt row (never abandoned)
    expect(await queuedPosts()).toBe(1);
  });

  it("a day on, the others aged out: it posts once with its ids, and C-21 counts it 2 h and 23 h after that POST", async () => {
    h.t.clock.advance(24 * H);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
    const postedAt = h.t.clock.nowMs();
    await dueNow();
    await runQueued(h, "postPayoutBatch");
    const b = await batch();
    expect(sent).toEqual([{ at: postedAt, sbid: b?.senderBatchId }]);
    expect(b?.paypalBatchId).not.toBeNull();
    expect(await runState()).toBe("POSTED");
    expect(await sentMarks(b?.id as string)).toBe(1);
    h.t.clock.advance(2 * H);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    h.t.clock.advance(21 * H);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    h.t.clock.advance(H + JUDGE_QUOTA.restampAfterMs + 1_000);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
  });
});
