// The judge quota ledger and the live lane on embedded Postgres (S3.9, plan "Limits"): a post is decided
// and reserved in one step under one lock, so two judges at cap−1 never both post (from any process); the
// spend and the slot of a post survive the purge of its workspace; the sandbox rail needs a fresh balance
// reading; and the live lane is single-flight across processes. Nothing here reaches PayPal.
import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { AppDeps } from "../lib/context.js";
import { createTestApp, setWorkspaceExpiry, type TestApp, type TestAppOptions } from "../test/index.js";
import { LANE_DEFAULTS } from "./lane.js";
import { beginLiveStep, ELSEWHERE_RETRY_MS, NO_JUDGE_QUOTA } from "./live-step.js";
import {
  estimateBalance,
  holdsLivePost,
  JUDGE_QUOTA,
  judgeRail,
  liveBatchesInLast24h,
  quotaFacts,
  recordBalanceReading,
  recordJudgeCode,
  reserveLivePost,
  settleLivePost,
} from "./quota.js";
import { judgeRuntime } from "./runtime.js";

const SANDBOX = {
  PP_MODE: "sandbox",
  PP_CLIENT_ID: "test",
  PP_CLIENT_SECRET: "test",
  PP_WEBHOOK_ID: "WH-TEST",
};
/** Any PayPal request fails the test: the quota and the lane decide; they never call out. */
const noPayPal = async (): Promise<Response> => {
  throw new Error("this test must not reach PayPal");
};
const ONE_MILLION = 100_000_000; // US$1,000,000: the daily cap is 40 on any date, so the hourly 3 binds
const BATCH = 36_839; // US$368.39, the seed's batch

let t: TestApp;
let apps: TestApp[] = [];

async function open(o: TestAppOptions = {}): Promise<TestApp> {
  const app = await createTestApp({
    db: "postgres",
    clock: new Date(),
    env: SANDBOX,
    paypalFetch: noPayPal,
    ...o,
  });
  apps.push(app);
  t = app;
  return app;
}
afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

/** Another fs-api process: the same database, its own in-process lane and throttles. */
const otherProcess = (deps: AppDeps): AppDeps => ({ ...deps });

async function judgeWorkspace(app: TestApp = t): Promise<string> {
  const owner = app.pg?.owner.sql;
  if (!owner) throw new Error("no database");
  const [row] = await owner<{ id: string }[]>`
    insert into workspaces (id, kind, name, claimed_at, expires_at)
    values (fs_uuidv7(), 'judge', 'quota-test', now(), now() + interval '1 day') returning id`;
  return row?.id as string;
}

async function reading(cents: number, asOf: Date = t.clock.now()): Promise<void> {
  await recordBalanceReading(t.deps.db, {
    rail: "sandbox",
    availableCents: cents,
    asOf,
    source: "searchBalances",
  });
}

async function reserve(
  deps: AppDeps,
  o: { workspaceId?: string; runId?: string; amountCents?: number; resume?: boolean } = {},
) {
  return reserveLivePost(deps, {
    workspaceId: o.workspaceId ?? (await judgeWorkspace()),
    sessionId: null,
    runId: o.runId ?? randomUUID(),
    amountCents: o.amountCents ?? BATCH,
    ...(o.resume ? { resume: true } : {}),
  });
}

/** Other judges' live posts fill the rolling 24 h (two hours ago: this clock hour's cap is not what binds). */
async function fillTheDay(): Promise<void> {
  const at = new Date(t.clock.nowMs() - 2 * 3_600_000);
  for (let i = 0; i < JUDGE_QUOTA.dailyMax; i++) {
    await t.deps.db.insert(schema.reconciliationReports).values({
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

/** A live batch row written at `at` (C-21 counts every one on its rail, in every workspace). */
async function liveBatch(o: {
  workspaceId: string;
  runId: string;
  at: Date;
  status?: "SUBMITTED" | "SUCCESS";
}): Promise<void> {
  const owner = t.pg?.owner.db;
  if (!owner) throw new Error("no database");
  await owner.insert(schema.payoutBatches).values({
    workspaceId: o.workspaceId,
    runId: o.runId,
    senderBatchId: `2026A-c21-${randomUUID()}`,
    requestId: "a".repeat(64),
    batchSha256: "b".repeat(64),
    kind: "primary",
    status: o.status ?? "SUCCESS",
    itemCount: 8,
    totalCents: BigInt(BATCH),
    currency: "USD",
    provenance: "live",
    submittedAt: o.at,
  });
}

async function facts(deps: AppDeps = t.deps) {
  return quotaFacts(deps, { workspaceId: await judgeWorkspace(), sessionId: null, now: deps.clock.now() });
}

describe("the binding decision (reserveLivePost)", () => {
  it("inv.quota.cas: judges at cap−1 posting at once from two processes: exactly one reserves", async () => {
    await open();
    await reading(ONE_MILLION);
    for (let i = 0; i < JUDGE_QUOTA.hourlyMax - 1; i++)
      expect((await reserve(t.deps)).reservation).not.toBeNull();
    const other = otherProcess(t.deps);
    const ws = await Promise.all([1, 2, 3, 4].map(() => judgeWorkspace()));
    // every peek still says live: a check-then-act protocol would post four times
    for (const [i, w] of ws.entries()) {
      const d = await judgeRail(i % 2 ? other : t.deps, { workspaceId: w, sessionId: null, step: "post" });
      expect(d.mode).toBe("live");
    }
    const raced = await Promise.all(ws.map((w, i) => reserve(i % 2 ? other : t.deps, { workspaceId: w })));
    expect(raced.filter((r) => r.reservation !== null)).toHaveLength(1);
    for (const r of raced.filter((x) => x.reservation === null)) {
      expect(r.decision).toMatchObject({ mode: "replay", reason: "hourly_cap" });
      expect(r.decision.label).toBe("Replay: this hour's live payouts are used up");
    }
    expect((await facts()).postsThisHour).toBe(JUDGE_QUOTA.hourlyMax);
  });

  it("a retried post keeps its slot past the cap; not_posted frees it; denied keeps the slot but moves no money", async () => {
    await open();
    await reading(ONE_MILLION);
    const first = await reserve(t.deps);
    await reserve(t.deps);
    const runX = randomUUID();
    const wsX = await judgeWorkspace();
    const x = await reserve(t.deps, { workspaceId: wsX, runId: runX });
    expect(x.reservation).not.toBeNull();
    const y = await reserve(t.deps);
    expect(y.decision.reason).toBe("hourly_cap");
    // the outbox retries X's post: it holds its slot, so the cap does not turn it into a replay
    const again = await reserve(t.deps, { workspaceId: wsX, runId: runX });
    expect(again.decision.mode).toBe("live");
    expect(again.reservation?.id).toBe(x.reservation?.id);
    // X's post was refused before PayPal (nothing sent): the slot is free for the next run
    await settleLivePost(t.deps, { reservationId: x.reservation?.id as string, outcome: "not_posted" });
    expect(
      await settleLivePost(t.deps, { reservationId: x.reservation?.id as string, outcome: "posted" }),
    ).toEqual(
      { settled: false, outcome: "not_posted" }, // the first settlement stands
    );
    const runZ = randomUUID();
    const z = await reserve(t.deps, { runId: runZ, amountCents: 50_000 });
    expect(z.reservation).not.toBeNull();
    // PayPal refused Z synchronously: it used a live slot, but no money left the account
    await settleLivePost(t.deps, { reservationId: z.reservation?.id as string, outcome: "denied" });
    const f = await facts();
    expect(f.postsThisHour).toBe(JUDGE_QUOTA.hourlyMax);
    expect(f.balance).toMatchObject({
      source: "reading",
      spentCents: 2 * BATCH,
      cents: ONE_MILLION - 2 * BATCH,
    });
    expect(first.reservation?.amountCents).toBe(BATCH);
  });

  it("the public third: a run a public session posted stays public when the session unlocks the code before its resume", async () => {
    await open();
    await reading(ONE_MILLION);
    // twelve public posts two hours ago: one public place is left of the 13 (40 / 3)
    for (let i = 0; i < 12; i++) {
      await t.deps.db.insert(schema.reconciliationReports).values({
        kind: "balance",
        windowEnd: new Date(t.clock.nowMs() - 2 * 3_600_000),
        summary: {
          v: 1,
          entry: "judge_post",
          runId: randomUUID(),
          workspaceId: randomUUID(),
          sessionId: randomUUID(),
          coded: false,
          amountCents: 100,
          rail: "sandbox",
        },
      });
    }
    const p = randomUUID();
    const runA = randomUUID();
    const wsA = await judgeWorkspace();
    const first = await reserveLivePost(t.deps, {
      workspaceId: wsA,
      sessionId: p,
      runId: runA,
      amountCents: BATCH,
    });
    expect(first.reservation).toMatchObject({ coded: false });
    expect(first.decision.quota).toMatchObject({ publicCap: 13, publicUsed: 13 });
    // PayPal created A's batch, but its answer was lost; another public session is refused meanwhile
    const refused = await reserve(t.deps, { workspaceId: await judgeWorkspace() });
    expect(refused.decision).toMatchObject({ mode: "replay", reason: "public_share" });
    // P unlocks the judge code; A's post resumes 10 minutes on under a fresh slot: still a public post
    await recordJudgeCode(t.deps.db, { sessionId: p, at: t.clock.now() });
    t.clock.advance(10 * 60_000);
    const resumed = await reserveLivePost(t.deps, {
      workspaceId: wsA,
      sessionId: p,
      runId: runA,
      amountCents: BATCH,
      resume: true,
    });
    expect(resumed.reservation).toMatchObject({ coded: false });
    // 70 minutes on: no public place has been freed (13 public creations, the cap)
    t.clock.advance(70 * 60_000);
    const peek = await judgeRail(t.deps, {
      workspaceId: await judgeWorkspace(),
      sessionId: randomUUID(),
      step: "post",
    });
    expect(peek).toMatchObject({ mode: "replay", reason: "public_share", quota: { publicUsed: 13 } });
  });
});

describe("a held slot carries a post for one lane lease in its clock hour; later the post takes a fresh slot dated now", () => {
  it("inv.quota.restamp: a quick retry keeps the slot; a lease later, or in the next clock hour, the post needs a new one", async () => {
    await open({ clock: new Date("2026-10-28T02:00:00.000Z") });
    await reading(ONE_MILLION);
    // the threshold is the live lane's lease: a slot younger than one burst is that burst's
    expect(JUDGE_QUOTA.restampAfterMs).toBe(LANE_DEFAULTS.leaseMs);
    const ws = await judgeWorkspace();
    const runX = randomUUID();
    const first = await reserve(t.deps, { workspaceId: ws, runId: runX });
    expect(first.reservation).not.toBeNull();
    // a minute on (the same clock hour) the retried post goes live under it, past a full day: unchanged
    t.clock.advance(60_000);
    await fillTheDay();
    expect(await holdsLivePost(t.deps.db, runX, t.clock.now())).toBe(true);
    const held = await reserve(t.deps, { workspaceId: ws, runId: runX, resume: true });
    expect(held.decision.mode).toBe("live");
    expect(held.reservation?.id).toBe(first.reservation?.id);
    // a lease later it carries nothing: the post would reach PayPal now, so it needs a slot dated now, and the full
    // day (its own slot aside) leaves none: it waits
    t.clock.advance(JUDGE_QUOTA.restampAfterMs);
    expect(await holdsLivePost(t.deps.db, runX, t.clock.now())).toBe(false);
    const full = await reserve(t.deps, { workspaceId: ws, runId: runX, resume: true });
    expect(full).toMatchObject({ decision: { mode: "replay", reason: "daily_cap" }, reservation: null });
    // the others age out: a FRESH slot dated now supersedes the old one, and the run is counted once
    t.clock.advance(23 * 3_600_000);
    await reading(ONE_MILLION);
    const fresh = await reserve(t.deps, { workspaceId: ws, runId: runX, resume: true });
    expect(fresh.decision.mode).toBe("live");
    expect(fresh.reservation?.id).not.toBe(first.reservation?.id);
    expect(fresh.reservation?.reservedAt).toEqual(t.clock.now());
    expect(fresh.decision.quota.used24h).toBe(1);
    expect((await facts()).posts24h).toBe(1);
    // and that one is the slot the run holds from now on
    const again = await reserve(t.deps, { workspaceId: ws, runId: runX, resume: true });
    expect(again.reservation?.id).toBe(fresh.reservation?.id);
  });

  it("a slot taken in the last seconds of a clock hour carries no retry into the next hour (counted where it lands)", async () => {
    await open({ clock: new Date("2026-10-28T02:59:30.000Z") });
    await reading(ONE_MILLION);
    const ws = await judgeWorkspace();
    const runY = randomUUID();
    const first = await reserve(t.deps, { workspaceId: ws, runId: runY });
    expect(first.reservation).not.toBeNull();
    // three other posts in the next hour fill it before the retry
    t.clock.advance(31_000);
    for (let i = 0; i < JUDGE_QUOTA.hourlyMax; i++)
      expect((await reserve(t.deps)).reservation).not.toBeNull();
    expect(await holdsLivePost(t.deps.db, runY, t.clock.now())).toBe(false);
    const late = await reserve(t.deps, { workspaceId: ws, runId: runY, resume: true });
    expect(late).toMatchObject({ decision: { mode: "replay", reason: "hourly_cap" }, reservation: null });
  });

  it("D2: on the last judging day a resume's fresh slot keeps balance minus its batch above the floor", async () => {
    await open({ clock: new Date("2026-12-14T02:00:00.000Z") });
    const judge = await t.fixture({ kind: "judge", withRun: true });
    const runId = judge.runId as string;
    await liveBatch({
      workspaceId: judge.workspaceId,
      runId,
      at: new Date(t.clock.nowMs() - 2 * 3_600_000),
      status: "SUBMITTED",
    });
    // US$10,350: one day left, so the formula allows a run (US$345), but this US$368.39 batch would leave US$9,981.61
    await reading(JUDGE_QUOTA.replayFloorCents + 35_000);
    // a judge-code session (the day's one slot is no public share)
    const sessionId = randomUUID();
    await recordJudgeCode(t.deps.db, { sessionId, at: t.clock.now() });
    const resume = (amountCents: number) =>
      reserveLivePost(t.deps, {
        workspaceId: judge.workspaceId,
        sessionId,
        runId,
        amountCents,
        resume: true,
      });
    expect(await resume(BATCH)).toMatchObject({
      decision: { mode: "replay", reason: "balance_low" },
      reservation: null,
    });
    // a batch the floor still covers takes its slot (the service's guard at a first write, applied to the resume)
    expect((await resume(30_000)).reservation).not.toBeNull();
  });

  it("C-21 counts a written batch from any live slot of its run in the window too, and a late resume answers to it", async () => {
    await open();
    await reading(ONE_MILLION);
    const judge = await t.fixture({ kind: "judge", withRun: true });
    const runId = judge.runId as string;
    const r = await reserve(t.deps, { workspaceId: judge.workspaceId, runId });
    expect(r.reservation).not.toBeNull();
    await liveBatch({ workspaceId: judge.workspaceId, runId, at: t.clock.now(), status: "SUBMITTED" });
    expect(await liveBatchesInLast24h(t.deps.db, "live", t.clock.now())).toBe(1);
    // the post stalls for 25 h: its write is out of C-21's window
    t.clock.advance(25 * 3_600_000);
    await reading(ONE_MILLION);
    expect(await liveBatchesInLast24h(t.deps.db, "live", t.clock.now())).toBe(0);
    // a co-op's own workspace posts C-21's 40 meanwhile (the judge quota counts judge posts only)
    const coop = await t.fixture({ kind: "real", withRun: true });
    const twoHoursAgo = new Date(t.clock.nowMs() - 2 * 3_600_000);
    for (let i = 0; i < JUDGE_QUOTA.dailyMax; i++) {
      await liveBatch({ workspaceId: coop.workspaceId, runId: coop.runId as string, at: twoHoursAgo });
    }
    expect(await liveBatchesInLast24h(t.deps.db, "live", t.clock.now())).toBe(JUDGE_QUOTA.dailyMax);
    expect((await facts()).posts24h).toBe(0);
    // the service checks C-21 only at the first write: the resumed post takes no slot over it
    const over = await reserve(t.deps, { workspaceId: judge.workspaceId, runId, resume: true });
    expect(over).toMatchObject({ decision: { mode: "replay", reason: "daily_cap" }, reservation: null });
    // D8: a fresh (non-resume) post is not held to C-21 here while C-21 is full: the service checks it at its write
    const freshWhileFull = await reserve(t.deps, { workspaceId: judge.workspaceId });
    expect(freshWhileFull.reservation).not.toBeNull();
    await settleLivePost(t.deps, {
      reservationId: freshWhileFull.reservation?.id as string,
      outcome: "not_posted",
    });
    // a day on, the co-op's batches are out of the window: a new slot, and C-21 counts the batch from it
    t.clock.advance(23 * 3_600_000);
    const late = await reserve(t.deps, { workspaceId: judge.workspaceId, runId, resume: true });
    expect(late.reservation).not.toBeNull();
    expect(late.reservation?.id).not.toBe(r.reservation?.id);
    expect(await liveBatchesInLast24h(t.deps.db, "live", t.clock.now())).toBe(1);
    // a fresh post is decided as before (C-21 is the service's, at its first write)
    expect((await reserve(t.deps, { workspaceId: judge.workspaceId })).reservation).not.toBeNull();
  });
});

describe("the balance", () => {
  it("the sandbox rail needs a fresh reading: none, or one older than 26 h, replays as balance_unknown", async () => {
    await open();
    const ws = await judgeWorkspace();
    const post = () => judgeRail(t.deps, { workspaceId: ws, sessionId: null, step: "post" });
    expect(await post()).toMatchObject({
      mode: "replay",
      reason: "balance_unknown",
      label: "Replay: the sandbox balance has not been read in the last day",
      quota: { dailyCap: 0, balance: { cents: null, source: "unknown", at: null } },
    });
    const now = t.clock.nowMs();
    await reading(ONE_MILLION, new Date(now - JUDGE_QUOTA.readingMaxAgeMs - 60_000));
    expect((await post()).reason).toBe("balance_unknown");
    await reading(900_000, new Date(now - 3_600_000)); // US$9,000: under the US$10,000 floor
    expect(await post()).toMatchObject({
      mode: "replay",
      reason: "balance_low",
      quota: { balance: { cents: 900_000, source: "reading" } },
    });
    await reading(ONE_MILLION, new Date(now));
    expect(await post()).toMatchObject({ mode: "live", quota: { dailyCap: 40 } });
    // a cancel never depends on the balance
    expect((await judgeRail(t.deps, { workspaceId: ws, sessionId: null, step: "cancel" })).mode).toBe("live");
  });

  it("post, then purge: the spend and the slot stay counted (the quota ledger is system rows)", async () => {
    await open();
    const now = t.clock.now();
    await reading(ONE_MILLION, new Date(now.getTime() - 3_600_000));
    const fx = await t.fixture({ kind: "judge", withRun: true });
    const runId = fx.runId as string;
    const r = await reserve(t.deps, { workspaceId: fx.workspaceId, runId });
    expect(r.reservation).not.toBeNull();
    const owner = t.pg?.owner.db;
    if (!owner) throw new Error("no database");
    await owner.insert(schema.payoutBatches).values({
      workspaceId: fx.workspaceId,
      runId,
      senderBatchId: `2026A-quota-${runId.slice(0, 8)}`,
      requestId: "a".repeat(64),
      batchSha256: "b".repeat(64),
      kind: "primary",
      status: "SUCCESS",
      itemCount: 8,
      totalCents: BigInt(BATCH),
      currency: "USD",
      provenance: "live",
      submittedAt: now,
    });
    await settleLivePost(t.deps, { reservationId: r.reservation?.id as string, outcome: "posted" });
    const before = await estimateBalance(t.deps.db, "sandbox", now);
    expect(before).toMatchObject({ cents: ONE_MILLION - BATCH, spentCents: BATCH, source: "reading" });

    // the hourly purge removes the workspace and, with it, its batch rows (the database's 24 hours are over)
    const ownerSql = t.pg?.owner.sql;
    if (!ownerSql) throw new Error("db");
    await setWorkspaceExpiry(ownerSql, fx.workspaceId, new Date(Date.now() - 60_000));
    await t.deps.db.execute(sql`select fs_purge_workspace(${fx.workspaceId}::uuid)`);
    expect(
      await t.deps.db.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.runId, runId)),
    ).toHaveLength(0);
    // …but the money it moved and the live slot it used are still counted
    expect(await estimateBalance(t.deps.db, "sandbox", now)).toEqual(before);
    expect((await facts()).posts24h).toBe(1);
  });

  it("the simulated rail starts from the simulator's opening balance and spends every simulated post", async () => {
    await open({ env: {}, simulator: { name: "quota-test-sim", fetch: noPayPal } });
    const ws = await judgeWorkspace();
    const d = await judgeRail(t.deps, { workspaceId: ws, sessionId: null, step: "post" });
    expect(d).toMatchObject({
      mode: "live",
      rail: "simulated",
      label: "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)",
      quota: { balance: { cents: JUDGE_QUOTA.simulatorOpeningCents, source: "simulator_opening" } },
    });
    const r = await reserve(t.deps, { workspaceId: ws });
    expect(r.reservation?.rail).toBe("simulated");
    expect(await estimateBalance(t.deps.db, "simulated", t.clock.now())).toMatchObject({
      cents: JUDGE_QUOTA.simulatorOpeningCents - BATCH,
      source: "simulator_opening",
    });
    // a sandbox post would not draw on the simulator's money
    expect((await estimateBalance(t.deps.db, "sandbox", t.clock.now())).cents).toBeNull();
  });
});

describe("the live lane (beginLiveStep)", () => {
  it("is single-flight across processes: the next burst queues here (with its place) and elsewhere (retry)", async () => {
    await open();
    await reading(ONE_MILLION);
    const other = otherProcess(t.deps);
    const [wsA, wsB, wsC] = [await judgeWorkspace(), await judgeWorkspace(), await judgeWorkspace()];
    const a = await beginLiveStep(t.deps, {
      workspaceId: wsA,
      sessionId: null,
      step: "post",
      runId: randomUUID(),
    });
    expect(a).toMatchObject({ kind: "live", decision: { mode: "live" } });
    if (a.kind !== "live") return;
    expect(a.reservation).toMatchObject({ workspaceId: wsA, amountCents: 0, rail: "sandbox" });

    const b = await beginLiveStep(t.deps, { workspaceId: wsB, sessionId: null, step: "invoice" });
    expect(b).toMatchObject({
      kind: "queued",
      position: 1,
      etaMs: judgeRuntime(t.deps).lane.options.burstMs,
    });
    const c = await beginLiveStep(other, { workspaceId: wsC, sessionId: null, step: "cancel" });
    expect(c).toMatchObject({ kind: "queued", position: null, retryAfterMs: ELSEWHERE_RETRY_MS });

    await a.end("posted");
    // the other process asks again and gets the lane; this process's next burst now waits on it
    const c2 = await beginLiveStep(other, { workspaceId: wsC, sessionId: null, step: "cancel" });
    expect(c2.kind).toBe("live");
    const b2 = await beginLiveStep(t.deps, { workspaceId: wsB, sessionId: null, step: "invoice" });
    expect(b2).toMatchObject({ kind: "queued", position: null });
    if (c2.kind === "live") await c2.end();
    const b3 = await beginLiveStep(t.deps, { workspaceId: wsB, sessionId: null, step: "invoice" });
    expect(b3.kind).toBe("live");
    if (b3.kind === "live") await b3.end();
    expect(judgeRuntime(t.deps).lane.view().depth).toBe(0);
    expect(judgeRuntime(other).lane.view().depth).toBe(0);
  });

  it("a post at the cap replays before it ever queues, and leaves the lane free for the next burst", async () => {
    await open();
    await reading(ONE_MILLION);
    for (let i = 0; i < JUDGE_QUOTA.hourlyMax; i++) await reserve(t.deps);
    const ws = await judgeWorkspace();
    const step = await beginLiveStep(t.deps, {
      workspaceId: ws,
      sessionId: null,
      step: "post",
      runId: randomUUID(),
    });
    expect(step).toMatchObject({ kind: "replay", decision: { reason: "hourly_cap" } });
    expect(judgeRuntime(t.deps).lane.view().depth).toBe(0);
    // the lock is free too: another process takes the lane at once
    const other = otherProcess(t.deps);
    const next = await beginLiveStep(other, { workspaceId: ws, sessionId: null, step: "cancel" });
    expect(next.kind).toBe("live");
    if (next.kind === "live") await next.end();
  });

  it("outside Judge Mode a step is live with no lane and no quota (the run slice's own guards stand)", async () => {
    await open();
    const fx = await t.fixture({ kind: "showcase", withRun: true });
    const step = await beginLiveStep(t.deps, {
      workspaceId: fx.workspaceId,
      step: "post",
      runId: fx.runId as string,
    });
    expect(step).toMatchObject({
      kind: "live",
      reservation: null,
      decision: { mode: "live", quota: NO_JUDGE_QUOTA },
    });
    expect(judgeRuntime(t.deps).lane.view().depth).toBe(0);
    expect(
      await t.deps.db
        .select()
        .from(schema.reconciliationReports)
        .where(eq(schema.reconciliationReports.kind, "balance")),
    ).toHaveLength(0);
  });
});
