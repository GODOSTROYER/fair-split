// The order of the two money locks (S3.9, C-21, plan "Limits"), on embedded Postgres with PayPal answered by msw.
// The judge quota lock (`fs:judge-quota`, judge/quota.ts) and the payout spend lock (`fs:payout-spend`,
// money/payouts.ts) are taken in ONE order everywhere both can be held: the quota lock first, then the spend lock.
//   - a resumed judge post that takes a fresh slot (`reserveLivePost` resume) holds the quota lock and takes the
//     spend lock for its C-21 count and the slot it writes, so a co-op's first write (the service's spend guard, under
//     the spend lock from its C-21 read to its write) and the judge's resume never both pass at 39;
//   - the service's spend guard and the re-route resume's C-21 guard hold only the spend lock (never the quota lock),
//     and `settleLivePost` (the burst's end) holds only the quota lock: no transaction waits for the quota lock while
//     holding the spend lock, so no two can deadlock.
// The re-route guard (`countResumedSend`) takes a lock only on its locked path: a batch last counted more than a lane
// lease ago. Its tests use batches written a day before, so they wait for the spend lock and mark the batch sent; the
// concurrent mix runs real co-op first writes (the service holds the spend lock from its C-21 read to its write) and
// those locked guards beside the quota-first resumes and settles.
import { randomUUID } from "node:crypto";
import { type Db, schema, systemScope } from "@fairsplit/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countResumedSend,
  JUDGE_QUOTA,
  recordBalanceReading,
  reserveLivePost,
  settleLivePost,
} from "../judge/quota.js";
import { ACTORS } from "../runs/events.js";
import { type RunsHarness, resolveAll, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { seedWorld } from "../runs/test/world.js";
import { payoutsServiceFor, postsInLast24h, SPEND_LOCK } from "./payouts.js";

const QUOTA_LOCK = "fs:judge-quota";
const BATCH = 36_839;
const H = 3_600_000;

const script = paypalScript();
let a: RunsHarness;
let b: RunsHarness;
let judge: { workspaceId: string; runId: string; batchId: string };
let coop: { workspaceId: string; runId: string };
/** Two more co-ops, each with a run reviewed and signed only in the concurrent mix: its first writes. */
let approved: RunsHarness[] = [];

/** The officers' frame tokens for a workspace, issued at the clock's now. */
async function tokensFor(base: RunsHarness, workspaceId: string): Promise<RunsHarness["tokens"]> {
  const tk = (role: "treasurer" | "board" | "clerk" | "member" | "brand", persona: string) =>
    base.t.credentials.frameToken({ workspaceId, role, persona });
  return {
    treasurer: await tk("treasurer", "analyn"),
    chair: await tk("board", "ernesto"),
    clerk: await tk("clerk", "jessie"),
    member: await tk("member", "celing"),
    brand: await tk("brand", "dana"),
  };
}

async function another(base: RunsHarness, invoice: string): Promise<RunsHarness> {
  const db = base.t.pg?.app.db;
  if (!db) throw new Error("db");
  const w = await seedWorld(db, {
    kind: "showcase",
    invoice: { paypalInvoiceId: invoice, status: "SENT", sent: true },
  });
  return { ...base, world: w, tokens: await tokensFor(base, w.workspaceId) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Another session holds `key` (a transaction-level advisory lock) until `release()`. */
async function holdLock(key: string): Promise<{ release(): Promise<void> }> {
  const owner = a.t.pg?.owner.sql;
  if (!owner) throw new Error("db");
  let release: () => void = () => undefined;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let held: () => void = () => undefined;
  const isHeld = new Promise<void>((r) => {
    held = r;
  });
  const done = owner.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    held();
    await released;
  });
  await isHeld;
  return {
    async release() {
      release();
      await done;
    },
  };
}

/** Whether some session holds `key` right now (a try from yet another session fails). */
async function heldElsewhere(key: string): Promise<boolean> {
  const owner = a.t.pg?.owner.sql;
  if (!owner) throw new Error("db");
  return owner.begin(async (tx) => {
    const [row] = await tx<
      { ok: boolean }[]
    >`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as ok`;
    return row?.ok !== true;
  });
}

async function deadlocks(): Promise<number> {
  const owner = a.t.pg?.owner.sql;
  if (!owner) throw new Error("db");
  const [row] = await owner<{ n: string }[]>`
    select deadlocks::text as n from pg_stat_database where datname = current_database()`;
  return Number(row?.n ?? 0);
}

/** Co-op batches written an hour ago until C-21's count is `n` (each a live batch on the sandbox rail). */
async function c21At(n: number) {
  const owner = a.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  const now = a.t.clock.now();
  while ((await postsInLast24h(a.t.deps, now)) < n) {
    await owner.insert(schema.payoutBatches).values({
      workspaceId: coop.workspaceId,
      runId: coop.runId,
      senderBatchId: `2026A-lock-${randomUUID()}`,
      requestId: "a".repeat(64),
      batchSha256: "b".repeat(64),
      kind: "primary",
      status: "SUCCESS",
      itemCount: 8,
      totalCents: BigInt(BATCH),
      currency: "USD",
      provenance: "live",
      submittedAt: new Date(now.getTime() - H),
    });
  }
  expect(await postsInLast24h(a.t.deps, now)).toBe(n);
}

/**
 * A co-op re-route written live 25 h before the clock and never marked sent: counted more than a lane lease ago, so
 * its resumed POST's C-21 guard (`countResumedSend`) takes its locked path.
 */
async function staleReroute(): Promise<string> {
  const owner = a.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  const writtenAt = a.t.clock.nowMs() - 25 * H;
  expect(a.t.clock.nowMs() - writtenAt).toBeGreaterThan(JUDGE_QUOTA.restampAfterMs);
  const [row] = await owner
    .insert(schema.payoutBatches)
    .values({
      workspaceId: coop.workspaceId,
      runId: coop.runId,
      senderBatchId: `2026A-lock-reroute-${randomUUID()}`,
      requestId: "e".repeat(64),
      batchSha256: "f".repeat(64),
      kind: "reroute",
      status: "SUBMITTED",
      itemCount: 1,
      totalCents: BigInt(100),
      currency: "USD",
      provenance: "live",
      submittedAt: new Date(writtenAt),
    })
    .returning({ id: schema.payoutBatches.id });
  return row?.id as string;
}

/** The `batch_sent` marks of a batch: only the guard's locked path writes one. */
async function sentMarks(batchId: string): Promise<number> {
  const [row] = (await a.t.deps.db.execute(sql`
    select count(*)::int as n from reconciliation_reports
     where kind = 'balance' and workspace_id is null
       and summary->>'entry' = 'batch_sent' and summary->>'batchId' = ${batchId}`)) as unknown as {
    n: number;
  }[];
  return Number(row?.n ?? 0);
}

const guardResume = (batchId: string) =>
  countResumedSend(a.t.deps.db as Db, { provenance: "live", batchId, now: a.t.clock.now() });

/** `p`, or a rejection once `ms` pass first (a call that waits for a lock held elsewhere). */
const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error(`still waiting after ${ms} ms: it asked for a lock held elsewhere`);
    }),
  ]);

const resumeJudge = () =>
  reserveLivePost(a.t.deps, {
    workspaceId: judge.workspaceId,
    sessionId: null,
    runId: judge.runId,
    amountCents: BATCH,
    resume: true,
  });

beforeAll(async () => {
  a = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
  b = await another(a, "INV2-TEST-LOCK-0002");
  approved = [await another(a, "INV2-TEST-LOCK-0003"), await another(a, "INV2-TEST-LOCK-0004")];
  for (const h of [a, b, ...approved]) await resolveAll(h);
  // the mix's co-ops sign later, so their co-sign is still live a day on
  for (const h of [a, b]) await signBoth(h);
  await recordBalanceReading(a.t.deps.db, {
    rail: "sandbox",
    availableCents: 100_000_000,
    asOf: a.t.clock.now(),
    source: "searchBalances",
  });
  const fx = await a.t.fixture({ kind: "judge", withRun: true });
  const c = await a.t.fixture({ kind: "real", withRun: true });
  coop = { workspaceId: c.workspaceId, runId: c.runId as string };
  // the judge run's batch was written live a day ago and never posted: its post resumes, on a fresh slot
  const owner = a.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  const [row] = await owner
    .insert(schema.payoutBatches)
    .values({
      workspaceId: fx.workspaceId,
      runId: fx.runId as string,
      senderBatchId: `2026A-lock-judge-${randomUUID()}`,
      requestId: "c".repeat(64),
      batchSha256: "d".repeat(64),
      kind: "primary",
      status: "SUBMITTED",
      itemCount: 8,
      totalCents: BigInt(BATCH),
      currency: "USD",
      provenance: "live",
      submittedAt: new Date(a.t.clock.nowMs() - 25 * H),
    })
    .returning({ id: schema.payoutBatches.id });
  judge = { workspaceId: fx.workspaceId, runId: fx.runId as string, batchId: row?.id as string };
});
afterAll(async () => a?.close());

describe("inv.lock-order: the quota lock, then the spend lock, everywhere both are held", () => {
  it("the service's spend guard never asks for the quota lock: a co-op post completes while it is held elsewhere", async () => {
    const quota = await holdLock(QUOTA_LOCK);
    try {
      const service = await payoutsServiceFor(b.t.deps, systemScope(b.world.workspaceId, ACTORS.outbox));
      expect(await service.executeApproved(b.world.runId)).toMatchObject({ kind: "created" });
    } finally {
      await quota.release();
    }
  });

  it("the re-route resume's C-21 guard (its locked path) takes the spend lock and never the quota lock", async () => {
    // the quota lock held elsewhere: the guard counts C-21 and marks the batch sent all the same
    const viaQuota = await staleReroute();
    const quota = await holdLock(QUOTA_LOCK);
    try {
      expect(await within(3_000, guardResume(viaQuota))).toEqual({ ok: true });
    } finally {
      await quota.release();
    }
    expect(await sentMarks(viaQuota)).toBe(1);
    // the spend lock held elsewhere: the guard waits for it, and marks nothing until it has it
    const viaSpend = await staleReroute();
    const spend = await holdLock(SPEND_LOCK);
    let done = false;
    let guard: Promise<unknown> = Promise.resolve();
    try {
      guard = guardResume(viaSpend).then((x) => {
        done = true;
        return x;
      });
      await sleep(400);
      expect(done).toBe(false);
      expect(await sentMarks(viaSpend)).toBe(0);
    } finally {
      await spend.release();
    }
    expect(await guard).toEqual({ ok: true });
    expect(await sentMarks(viaSpend)).toBe(1);
  });

  it("settleLivePost never asks for the spend lock: a burst's end settles while it is held elsewhere", async () => {
    const r = await reserveLivePost(a.t.deps, {
      workspaceId: judge.workspaceId,
      sessionId: null,
      runId: randomUUID(),
      amountCents: 100,
    });
    expect(r.reservation).not.toBeNull();
    const spend = await holdLock(SPEND_LOCK);
    try {
      expect(
        await settleLivePost(a.t.deps, { reservationId: r.reservation?.id as string, outcome: "not_posted" }),
      ).toEqual({ settled: true, outcome: "not_posted" });
    } finally {
      await spend.release();
    }
  });

  it("D1: a co-op's first write at C-21 39 holds the spend lock; the judge's resume waits for it and counts its batch", async () => {
    await c21At(JUDGE_QUOTA.dailyMax - 1);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    let writing = false;
    const first = await payoutsServiceFor(a.t.deps, systemScope(a.world.workspaceId, ACTORS.outbox), {
      repo: (base) => ({
        ...base,
        async writeSubmitted(batch) {
          writing = true;
          await gate;
          return base.writeSubmitted(batch);
        },
      }),
    });
    const coopPost = first.executeApproved(a.world.runId);
    while (!writing) await sleep(10);
    let judgeDone = false;
    const judgePost = resumeJudge().then((r) => {
      judgeDone = true;
      return r;
    });
    await sleep(400);
    // the co-op holds its C-21 check and write: the judge's C-21 count has not run
    expect(judgeDone).toBe(false);
    open();
    expect(await coopPost).toMatchObject({ kind: "created" });
    // it counted the co-op's batch: 40, so no slot (the post waits; never 41 batches in the window)
    expect(await judgePost).toMatchObject({
      decision: { mode: "replay", reason: "daily_cap" },
      reservation: null,
    });
    expect(await postsInLast24h(a.t.deps, a.t.clock.now())).toBe(JUDGE_QUOTA.dailyMax);
  });

  it("v: a resume holding the quota lock waits for the spend lock; a settle waits behind it; both finish, no deadlock", async () => {
    const before = await deadlocks();
    const r = await reserveLivePost(a.t.deps, {
      workspaceId: judge.workspaceId,
      sessionId: null,
      runId: randomUUID(),
      amountCents: 100,
    });
    expect(r.reservation).not.toBeNull();
    const spend = await holdLock(SPEND_LOCK);
    let resumed = false;
    let settled = false;
    let resumePost: Promise<unknown> = Promise.resolve();
    let settle: Promise<unknown> = Promise.resolve();
    try {
      resumePost = resumeJudge().then((x) => {
        resumed = true;
        return x;
      });
      // it takes the quota lock first, then waits for the spend lock while holding it
      const deadline = Date.now() + 5_000;
      while (!(await heldElsewhere(QUOTA_LOCK)) && Date.now() < deadline) await sleep(20);
      expect(await heldElsewhere(QUOTA_LOCK)).toBe(true);
      expect(resumed).toBe(false);
      settle = settleLivePost(a.t.deps, {
        reservationId: r.reservation?.id as string,
        outcome: "posted",
      }).then((x) => {
        settled = true;
        return x;
      });
      await sleep(300);
      expect(settled).toBe(false);
    } finally {
      await spend.release();
    }
    await Promise.all([resumePost, settle]);
    expect(resumed).toBe(true);
    expect(settled).toBe(true);
    expect(await deadlocks()).toBe(before);
  });

  it("v: many at once (resumes, settles, co-op first writes, the re-route guard's locked path) all finish, no deadlock", async () => {
    // a day on: the earlier batches leave C-21's window, so the co-op first writes and a resume go through (the
    // reading is 25 h old: still fresh)
    a.t.clock.advance(25 * H);
    for (const h of approved) {
      h.tokens = await tokensFor(h, h.world.workspaceId);
      await signBoth(h);
    }
    const before = await deadlocks();
    const reservations = await Promise.all(
      [1, 2, 3].map(() =>
        reserveLivePost(a.t.deps, {
          workspaceId: judge.workspaceId,
          sessionId: null,
          runId: randomUUID(),
          amountCents: 100,
        }),
      ),
    );
    const ids = reservations.map((x) => x.reservation?.id).filter((x): x is string => !!x);
    expect(ids).toHaveLength(3);
    const reroutes = [await staleReroute(), await staleReroute(), await staleReroute()];
    // spend first: the co-ops' first writes (spend lock from the C-21 read to the write) and the re-route guards
    const writes = approved.map(async (h) => {
      const service = await payoutsServiceFor(h.t.deps, systemScope(h.world.workspaceId, ACTORS.outbox));
      return service.executeApproved(h.world.runId);
    });
    const guards = reroutes.map((id) => guardResume(id));
    // quota first: resumes (quota, then spend), settles (quota only)
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      work.push(resumeJudge());
      work.push(postsInLast24h(a.t.deps, a.t.clock.now()));
    }
    for (const id of ids) work.push(settleLivePost(a.t.deps, { reservationId: id, outcome: "posted" }));
    const results = await Promise.allSettled([...writes, ...guards, ...work]);
    expect(results.filter((x) => x.status === "rejected")).toEqual([]);
    // the co-op posts were real first writes, and every guard took its locked path (it marked its batch sent)
    expect(await Promise.all(writes)).toMatchObject([{ kind: "created" }, { kind: "created" }]);
    expect(await Promise.all(guards)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    for (const id of reroutes) expect(await sentMarks(id)).toBe(1);
    expect(await deadlocks()).toBe(before);
  });
});
