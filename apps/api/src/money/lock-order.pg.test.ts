// The order of the two money locks (S3.9, C-21, plan "Limits"), on embedded Postgres with PayPal answered by msw.
// The judge quota lock (`fs:judge-quota`, judge/quota.ts) and the payout spend lock (`fs:payout-spend`,
// money/payouts.ts) are taken in ONE order everywhere both can be held: the quota lock first, then the spend lock.
//   - a resumed judge post that takes a fresh slot (`reserveLivePost` resume) holds the quota lock and takes the
//     spend lock for its C-21 count and the slot it writes, so a co-op's first write (the service's spend guard, under
//     the spend lock from its C-21 read to its write) and the judge's resume never both pass at 39;
//   - the service's spend guard and the re-route resume's C-21 guard hold only the spend lock (never the quota lock),
//     and `settleLivePost` (the burst's end) holds only the quota lock: no transaction waits for the quota lock while
//     holding the spend lock, so no two can deadlock.
import { randomUUID } from "node:crypto";
import { type Db, schema, systemScope } from "@fairsplit/db";
import { eq } from "drizzle-orm";
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
let coopBatchId: string;

async function another(base: RunsHarness): Promise<RunsHarness> {
  const db = base.t.pg?.app.db;
  if (!db) throw new Error("db");
  const w = await seedWorld(db, {
    kind: "showcase",
    invoice: { paypalInvoiceId: "INV2-TEST-LOCK-0002", status: "SENT", sent: true },
  });
  const tk = (role: "treasurer" | "board" | "clerk" | "member" | "brand", persona: string) =>
    base.t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona });
  return {
    ...base,
    world: w,
    tokens: {
      treasurer: await tk("treasurer", "analyn"),
      chair: await tk("board", "ernesto"),
      clerk: await tk("clerk", "jessie"),
      member: await tk("member", "celing"),
      brand: await tk("brand", "dana"),
    },
  };
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
  b = await another(a);
  for (const h of [a, b]) {
    await resolveAll(h);
    await signBoth(h);
  }
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

  it("the re-route resume's C-21 guard never asks for the quota lock either", async () => {
    const [posted] = await a.t.deps.db
      .select({ id: schema.payoutBatches.id })
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, b.world.runId));
    coopBatchId = posted?.id as string;
    const quota = await holdLock(QUOTA_LOCK);
    try {
      const r = await countResumedSend(a.t.deps.db as Db, {
        provenance: "live",
        batchId: coopBatchId,
        now: a.t.clock.now(),
      });
      expect(r.ok).toBe(true);
    } finally {
      await quota.release();
    }
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

  it("v: many at once (resumes, settles, co-op posts, the re-route guard) all finish with no deadlock", async () => {
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
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      work.push(resumeJudge());
      work.push(
        countResumedSend(a.t.deps.db as Db, {
          provenance: "live",
          batchId: coopBatchId,
          now: a.t.clock.now(),
        }),
      );
      work.push(postsInLast24h(a.t.deps, a.t.clock.now()));
    }
    for (const id of ids) work.push(settleLivePost(a.t.deps, { reservationId: id, outcome: "posted" }));
    const results = await Promise.allSettled(work);
    expect(results.filter((x) => x.status === "rejected")).toEqual([]);
    expect(await deadlocks()).toBe(before);
  });
});
