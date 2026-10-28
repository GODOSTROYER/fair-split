// The quota on resume (S3.9, plan "Limits", I8), on embedded Postgres on the sandbox rail with PayPal answered by msw.
// A judge post whose batch is written live is never replayed (rows PayPal may hold), and it never goes live without
// a quota slot held for its run, dated within a lane lease of its POST:
//   - a kill switch after the write leaves the run's reservation held (the rows still wait to be posted) and the post
//     waits; once the switch is off the batch posts on a fresh slot dated at its POST (its own earlier slot aside, so
//     a day at 40 with it still has room), the old slot is superseded, and nothing is counted twice;
//   - a written batch whose run holds no reservation (one settled not_posted after the write, as builds before this
//     fix settled the kill switch's refusal) waits while the 24 h cap is full: nothing reaches PayPal, nothing is
//     replayed, the rows stay SUBMITTED. With a slot free it takes a new reservation under the quota lock and is
//     posted once, with its sender_batch_id and PayPal-Request-Id, and counted;
//   - a resume after the circuit (7 min) posts the same way, and a fresh post over the quota still replays;
//   - a batch that stalled for a day (a kill switch kept on, an outage the catch-up resumes) waits while the day is
//     full and otherwise takes a new slot, counted from its post by the judge quota and by C-21.
// Each scenario has its own app, so its own judge quota ledger.
import { randomUUID } from "node:crypto";
import type { TaskName } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_QUOTA, judgeRail, recordBalanceReading } from "../judge/index.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";
import { postsInLast24h } from "./payouts.js";
import { resumeStalledPosts } from "./resume.js";

const POSTS = `${PAYPAL_SANDBOX}/v1/payments/payouts`;

interface Sent {
  senderBatchId: string | null;
  requestId: string | null;
}

/** A judge world on the sandbox rail whose every batch POST is recorded (sender_batch_id, PayPal-Request-Id). */
async function judgeWorld(
  script: ReturnType<typeof paypalScript>,
): Promise<{ h: RunsHarness; sent: Sent[] }> {
  const h = await startRuns({ paypal: script.handlers });
  const sent: Sent[] = [];
  // records every POST that reaches PayPal, then falls through to the script's answer
  h.paypal?.use(
    http.post(POSTS, ({ request }) => {
      sent.push({ senderBatchId: null, requestId: request.headers.get("paypal-request-id") });
    }),
  );
  return { h, sent };
}

/** PayPal paces the next POST (a 429 after the rows are written: the 6-minute circuit opens). */
function paceNextPost(h: RunsHarness, sent: Sent[]) {
  h.paypal?.use(
    http.post(
      POSTS,
      async ({ request }) => {
        sent.push({
          senderBatchId: ((await request.json()) as PostedBatch).sender_batch_header.sender_batch_id,
          requestId: request.headers.get("paypal-request-id"),
        });
        return paypalError(429, "RATE_LIMIT_REACHED");
      },
      { once: true },
    ),
  );
}

async function runState(h: RunsHarness) {
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

async function batchOf(h: RunsHarness) {
  const [batch] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  return batch;
}

async function itemStatuses(h: RunsHarness, batchId: string) {
  const rows = await h.t.deps.db
    .select({ status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .where(eq(schema.payoutItems.batchId, batchId));
  return [...new Set(rows.map((r) => r.status))];
}

async function replayedSteps(h: RunsHarness) {
  return (
    await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "judge.step.replayed"),
        ),
      )
      .orderBy(asc(schema.ledgerEntries.seq))
  ).map((e) => {
    const p = e.payload as { step: string; reason: string };
    return [p.step, p.reason];
  });
}

interface QuotaRow {
  id: string;
  entry: string;
  reservationId?: string;
  outcome?: string;
  amountCents?: number;
}

/** The run's rows in the judge quota ledger (reservations and settlements), oldest first. */
async function quotaLedger(h: RunsHarness): Promise<QuotaRow[]> {
  const rows = await h.t.deps.db
    .select({ id: schema.reconciliationReports.id, summary: schema.reconciliationReports.summary })
    .from(schema.reconciliationReports)
    .where(isNull(schema.reconciliationReports.workspaceId))
    .orderBy(asc(schema.reconciliationReports.createdAt), asc(schema.reconciliationReports.id));
  return rows
    .map((r) => ({ id: r.id, ...(r.summary as Omit<QuotaRow, "id"> & { runId?: string }) }))
    .filter((r) => r.runId === h.world.runId)
    .map(({ id, entry, reservationId, outcome, amountCents }) => ({
      id,
      entry,
      ...(reservationId ? { reservationId } : {}),
      ...(outcome ? { outcome } : {}),
      ...(amountCents !== undefined ? { amountCents } : {}),
    }));
}

const shape = (rows: QuotaRow[]) => rows.map((r) => [r.entry, r.outcome ?? null]);

/**
 * Other judges' live posts fill the rolling 24 h (two hours ago: this clock hour's cap is not what binds): `n` of
 * them, 40 by default (a full day without the run's own slot).
 */
async function fillTheDay(h: RunsHarness, n: number = JUDGE_QUOTA.dailyMax) {
  const at = new Date(h.t.clock.nowMs() - 2 * 3_600_000);
  for (let i = 0; i < n; i++) {
    await h.t.deps.db.insert(schema.reconciliationReports).values({
      kind: "balance",
      windowEnd: at,
      summary: {
        v: 1,
        entry: "judge_post",
        runId: randomUUID(),
        workspaceId: randomUUID(),
        sessionId: null,
        coded: true,
        amountCents: 100,
        rail: "sandbox",
      },
    });
  }
}

/**
 * The run's reservation settled `not_posted` although its rows are written: the ledger a build before this fix
 * left behind when a kill switch (or another refusal) stopped the resumed POST. The slot is free; the rows wait.
 */
async function freeTheSlot(h: RunsHarness) {
  const [reservation] = (await quotaLedger(h)).filter((r) => r.entry === "judge_post");
  if (!reservation) throw new Error("the run holds no reservation");
  await h.t.deps.db.insert(schema.reconciliationReports).values({
    kind: "balance",
    windowEnd: h.t.clock.now(),
    summary: {
      v: 1,
      entry: "judge_post_settled",
      reservationId: reservation.id,
      runId: h.world.runId,
      outcome: "not_posted",
    },
  });
}

/** Lets the waiting rows of a task run now (the outbox's schedule is the database's clock). */
async function due(h: RunsHarness, name: TaskName = "postPayoutBatch") {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, name),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

async function postRows(h: RunsHarness) {
  return h.t.deps.db
    .select({ state: schema.taskOutbox.state, runAfter: schema.taskOutbox.runAfter })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
      ),
    )
    .orderBy(asc(schema.taskOutbox.createdAt), asc(schema.taskOutbox.dedupeKey));
}

const peek = (h: RunsHarness) =>
  judgeRail(h.t.deps, { workspaceId: h.world.workspaceId, sessionId: null, step: "post" });

/** A day and an hour go by with the post stalled; the nightly reconciliation reads the balance again meanwhile. */
async function stallOverADay(h: RunsHarness) {
  h.t.clock.advance(25 * 3_600_000);
  await recordBalanceReading(h.t.deps.db, {
    rail: "sandbox",
    availableCents: 100_000_000,
    asOf: h.t.clock.now(),
    source: "searchBalances",
  });
}

/** Every post row of the run gone dead: an outage outlasted every attempt, nothing is left to post the batch. */
async function killPosts(h: RunsHarness) {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ state: "dead" })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
      ),
    );
}

/** Signs and posts; PayPal paces the first POST, so the rows are written and the post waits (reservation held). */
async function writeThenPace(h: RunsHarness, sent: Sent[]) {
  await resolveAll(h);
  await signBoth(h);
  paceNextPost(h, sent);
  await runQueued(h, "postPayoutBatch");
  expect(await runState(h)).toBe("POSTING");
  expect(sent).toHaveLength(1);
  expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
}

describe("a kill switch after the write keeps the slot held; switched off, the batch posts on a fresh slot dated at its POST", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
  });
  afterAll(async () => h?.close());

  it("the co-op pauses payouts after the write: the resumed post waits, nothing is sent, the reservation stays open", async () => {
    h.t.clock.advance(7 * 60_000); // the circuit has closed
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    const batch = await batchOf(h);
    expect(batch).toMatchObject({ status: "SUBMITTED", paypalBatchId: null, provenance: "live" });
    // the rows still wait to be posted: the slot is not handed back
    expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
    expect((await postRows(h)).filter((r) => r.state === "queued")).toHaveLength(1);
  });

  it("the day fills meanwhile (40 with its slot); the switch off, the same batch posts live once, counted once", async () => {
    await fillTheDay(h, JUDGE_QUOTA.dailyMax - 1);
    expect((await peek(h)).quota.used24h).toBe(JUDGE_QUOTA.dailyMax);
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: false } });
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    const batch = await batchOf(h);
    expect(batch?.provenance).toBe("live");
    expect(batch?.paypalBatchId).toBe(script.batchIdOf(0));
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual([batch?.senderBatchId]);
    expect(sent[0]?.senderBatchId).toBe(batch?.senderBatchId);
    expect(sent.map((s) => s.requestId)).toEqual([batch?.requestId, batch?.requestId]);
    // the slot taken at the write is superseded by the one dated at the POST, which is settled posted
    const ledger = await quotaLedger(h);
    expect(shape(ledger)).toEqual([
      ["judge_post", null],
      ["judge_post", null],
      ["judge_post_settled", "superseded"],
      ["judge_post_settled", "posted"],
    ]);
    expect(ledger[2]?.reservationId).toBe(ledger[0]?.id);
    expect(ledger[3]?.reservationId).toBe(ledger[1]?.id);
    // both slots are in the window: the run is one post of the 40
    expect((await peek(h)).quota.used24h).toBe(JUDGE_QUOTA.dailyMax);
    expect(await replayedSteps(h)).toEqual([]);
  });
});

describe("a written batch whose run holds no reservation waits while the 24 h cap is full", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    await freeTheSlot(h);
    await fillTheDay(h);
    h.t.clock.advance(7 * 60_000); // the circuit has closed: only the quota could stop the post
  });
  afterAll(async () => h?.close());

  it("the written batch counts as a live post for everyone else meanwhile", async () => {
    const decision = await peek(h);
    expect(decision).toMatchObject({ mode: "replay", reason: "daily_cap" });
    expect(decision.quota.used24h).toBe(JUDGE_QUOTA.dailyMax + 1);
  });

  it("the resume waits: nothing reaches PayPal, nothing is replayed, the rows stay SUBMITTED, no slot is taken", async () => {
    const before = Date.now();
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(script.calls).not.toContain("create_payout_batch");
    expect(await runState(h)).toBe("POSTING");
    const batch = await batchOf(h);
    expect(batch).toMatchObject({ status: "SUBMITTED", paypalBatchId: null, provenance: "live" });
    expect(await itemStatuses(h, batch?.id as string)).toEqual(["SUBMITTED"]);
    expect(await replayedSteps(h)).toEqual([]);
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "not_posted"],
    ]);
    // it waits as the press's next attempt row, due when a slot may have freed up (never the outbox's budget)
    const waiting = (await postRows(h)).filter((r) => r.state === "queued");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.runAfter.getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000);
  });

  it("asked again while the cap is still full, it waits again: still nothing sent or replayed", async () => {
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    expect(await replayedSteps(h)).toEqual([]);
    expect((await postRows(h)).filter((r) => r.state === "queued")).toHaveLength(1);
  });
});

describe("a written batch whose run holds no reservation takes a new one when a slot is free", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    await freeTheSlot(h);
    h.t.clock.advance(7 * 60_000);
  });
  afterAll(async () => h?.close());

  it("the resume reserves under the quota lock and posts live once, with its sender_batch_id and request id, counted", async () => {
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    const batch = await batchOf(h);
    expect(batch?.provenance).toBe("live");
    expect(batch?.paypalBatchId).toBe(script.batchIdOf(0));
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual([batch?.senderBatchId]);
    expect(sent[0]?.senderBatchId).toBe(batch?.senderBatchId);
    expect(sent.map((s) => s.requestId)).toEqual([batch?.requestId, batch?.requestId]);
    const ledger = await quotaLedger(h);
    expect(shape(ledger)).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "not_posted"],
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
    // the new reservation sets aside the written batch's own total, and it is the one settled posted
    expect(ledger[2]?.amountCents).toBe(Number(batch?.totalCents));
    expect(ledger[3]?.reservationId).toBe(ledger[2]?.id);
    // counted: this run is the one live post of the day
    expect((await peek(h)).quota.used24h).toBe(1);
    expect(await replayedSteps(h)).toEqual([]);
  });
});

describe("a resume after the circuit posts the written batch on a fresh slot, the day full but for its own slot", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    await fillTheDay(h, JUDGE_QUOTA.dailyMax - 1);
    h.t.clock.advance(7 * 60_000);
  });
  afterAll(async () => h?.close());

  it("posted live once, its slot dated at the POST (the one taken at the write superseded); the run counted once", async () => {
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    const batch = await batchOf(h);
    expect(batch?.provenance).toBe("live");
    expect(sent.map((s) => s.requestId)).toEqual([batch?.requestId, batch?.requestId]);
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post", null],
      ["judge_post_settled", "superseded"],
      ["judge_post_settled", "posted"],
    ]);
    expect((await peek(h)).quota.used24h).toBe(JUDGE_QUOTA.dailyMax);
    expect(await replayedSteps(h)).toEqual([]);
  });
});

describe("a fresh post over the quota still replays, labelled", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await resolveAll(h);
    await fillTheDay(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("nothing written yet and the 24 h cap full: the post replays (provenance replay, no POST, no slot)", async () => {
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(0);
    expect(script.calls).not.toContain("create_payout_batch");
    expect(await runState(h)).toBe("POSTED");
    expect((await batchOf(h))?.provenance).toBe("replay");
    expect(await replayedSteps(h)).toEqual([["post", "daily_cap"]]);
    expect(await quotaLedger(h)).toEqual([]);
  });
});

describe("S1: a post stalled for a day needs a slot dated at its POST: a kill switch kept on for 25 h, then the day full", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    // the co-op pauses payouts after the write: the resumed POST is refused and the slot stays held
    h.t.clock.advance(7 * 60_000);
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: false } });
    // …but it stays on in effect for a day and an hour: the post does not run until then
    await stallOverADay(h);
    await fillTheDay(h);
  });
  afterAll(async () => h?.close());

  it("the day is full: the slot taken 25 h ago carries no POST now, so the post waits; nothing sent, replayed or taken", async () => {
    const decision = await peek(h);
    expect(decision).toMatchObject({ mode: "replay", reason: "daily_cap" });
    expect(decision.quota.used24h).toBe(JUDGE_QUOTA.dailyMax);
    const before = Date.now();
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    const batch = await batchOf(h);
    expect(batch).toMatchObject({ status: "SUBMITTED", paypalBatchId: null, provenance: "live" });
    expect(await itemStatuses(h, batch?.id as string)).toEqual(["SUBMITTED"]);
    expect(await replayedSteps(h)).toEqual([]);
    expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
    const waiting = (await postRows(h)).filter((r) => r.state === "queued");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.runAfter.getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000);
    // the 41st post of the trailing 24 h never happened
    expect((await peek(h)).quota.used24h).toBe(JUDGE_QUOTA.dailyMax);
  });

  it("a day on, the others aged out: a new slot under the quota lock, the batch posted once, counted by both counts", async () => {
    h.t.clock.advance(23 * 3_600_000);
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    const batch = await batchOf(h);
    expect(batch?.provenance).toBe("live");
    expect(batch?.paypalBatchId).toBe(script.batchIdOf(0));
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual([batch?.senderBatchId]);
    expect(sent[0]?.senderBatchId).toBe(batch?.senderBatchId);
    expect(sent.map((s) => s.requestId)).toEqual([batch?.requestId, batch?.requestId]);
    const ledger = await quotaLedger(h);
    expect(shape(ledger)).toEqual([
      ["judge_post", null],
      ["judge_post", null],
      ["judge_post_settled", "superseded"],
      ["judge_post_settled", "posted"],
    ]);
    expect(ledger[1]?.amountCents).toBe(Number(batch?.totalCents));
    expect(ledger[2]?.reservationId).toBe(ledger[0]?.id);
    expect(ledger[3]?.reservationId).toBe(ledger[1]?.id);
    // counted from the post: by the judge quota, and by C-21 for every post after it
    expect((await peek(h)).quota.used24h).toBe(1);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    expect(await replayedSteps(h)).toEqual([]);
  });
});

describe("a post the catch-up resumes after a 25 h stall (no switch): it waits while the day is full, then takes a new slot", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    await killPosts(h);
    await stallOverADay(h);
    await fillTheDay(h);
  });
  afterAll(async () => h?.close());

  it("resumeStalledPosts gives the batch a post; the day full, it waits: nothing sent or replayed, no slot taken", async () => {
    expect(await resumeStalledPosts(h.t.deps)).toBe(1);
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    expect((await batchOf(h))?.status).toBe("SUBMITTED");
    expect(await replayedSteps(h)).toEqual([]);
    expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
    expect((await postRows(h)).filter((r) => r.state === "queued")).toHaveLength(1);
    expect(await resumeStalledPosts(h.t.deps)).toBe(0);
  });

  it("the others aged out: posted live once under a new slot, with its ids, counted", async () => {
    h.t.clock.advance(23 * 3_600_000);
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    const batch = await batchOf(h);
    expect(batch?.paypalBatchId).toBe(script.batchIdOf(0));
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual([batch?.senderBatchId]);
    expect(sent.map((s) => s.requestId)).toEqual([batch?.requestId, batch?.requestId]);
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post", null],
      ["judge_post_settled", "superseded"],
      ["judge_post_settled", "posted"],
    ]);
    expect((await peek(h)).quota.used24h).toBe(1);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    expect(await replayedSteps(h)).toEqual([]);
  });
});
