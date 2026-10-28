// The quota on resume (S3.9, plan "Limits", I8), on embedded Postgres on the sandbox rail with PayPal answered by msw.
// A judge post whose batch is written live is never replayed (rows PayPal may hold), and it never goes live without
// a quota slot held for its run:
//   - a kill switch that refuses the resumed POST after the write leaves the run's reservation held (the rows still
//     wait to be posted): once the switch is off the batch posts under it, the 24 h cap filled meanwhile
//     notwithstanding, and nothing is counted twice;
//   - a written batch whose run holds no reservation (one settled not_posted after the write, as builds before this
//     fix settled the kill switch's refusal) waits while the 24 h cap is full: nothing reaches PayPal, nothing is
//     replayed, the rows stay SUBMITTED. With a slot free it takes a new reservation under the quota lock and is
//     posted once, with its sender_batch_id and PayPal-Request-Id, and counted;
//   - the ordinary resume (its reservation held) is unchanged, and a fresh post over the quota still replays.
// Each scenario has its own app, so its own judge quota ledger.
import { randomUUID } from "node:crypto";
import type { TaskName } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_QUOTA, judgeRail } from "../judge/index.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";

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

/** Other judges' live posts fill the rolling 24 h (two hours ago: this clock hour's cap is not what binds). */
async function fillTheDay(h: RunsHarness) {
  const at = new Date(h.t.clock.nowMs() - 2 * 3_600_000);
  for (let i = 0; i < JUDGE_QUOTA.dailyMax; i++) {
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

describe("a kill switch after the write keeps the slot held: the batch posts under it once the switch is off", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
  });
  afterAll(async () => h?.close());

  it("the co-op pauses payouts after the write: the resumed POST is refused, nothing is sent, the reservation stays open", async () => {
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

  it("the 24 h cap fills meanwhile; the switch off, the same batch posts live once under its held reservation", async () => {
    await fillTheDay(h);
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
    // one slot, taken at the write, settled posted
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
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

describe("the ordinary resume is unchanged: a held reservation posts the written batch with the 24 h cap full", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    await fillTheDay(h);
    h.t.clock.advance(7 * 60_000);
  });
  afterAll(async () => h?.close());

  it("posted live once under the reservation taken at the write; no new slot", async () => {
    await due(h);
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    const batch = await batchOf(h);
    expect(batch?.provenance).toBe("live");
    expect(sent.map((s) => s.requestId)).toEqual([batch?.requestId, batch?.requestId]);
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
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
