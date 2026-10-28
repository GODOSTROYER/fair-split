// The hourly purge of an expired judge workspace never drops a batch a count still reads (S3.9, C-21, plan "Limits";
// round 4 of the `[ws/api]` review), on embedded Postgres on the sandbox rail with PayPal answered by msw. C-21
// (`liveBatchesInLast24h`) and the spend (`liveSpend`) count a batch from its `payout_batches` row, and the purge's
// cascade deletes that row. So the purge keeps an expired judge workspace while:
//   - C-21 still counts one of its batches: written in the window, POSTed late under a fresh slot of its run, or a
//     re-route marked sent (`batch_sent`) at its late POST, each for 24 h and a lane lease after;
//   - the spend still counts one: written, or named by PayPal (`batch_posted`), after a balance reading, which is at
//     most 26 h old (`JUDGE_QUOTA.readingMaxAgeMs`).
// The drift case: the rows are written 25 h ago and PayPal refuses the credentials; the post resumes 20 minutes ago
// under a fresh slot; the items settle, the session's 24 h run out and seven quiet minutes pass. The purge keeps the
// workspace, and C-21 counts the POST 2 h and 23 h after it. Once nothing counts the batch, the purge removes it.
// The purge decides by the database's clock (as `fs_purge_workspace()` does), so the app's clock runs close to it.
import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { estimateBalance, JUDGE_QUOTA, judgeRail, recordBalanceReading } from "../judge/index.js";
import { purgeExpiredJudgeWorkspaces } from "../judge/pool.js";
import { batchesStillCounted } from "../judge/quota.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError, setWorkspaceExpiry } from "../test/index.js";
import { estimatedBalanceCents, postsInLast24h } from "./payouts.js";
import { settleBatch } from "./settle.js";

const POSTS = `${PAYPAL_SANDBOX}/v1/payments/payouts`;
const H = 3_600_000;
const MIN = 60_000;
const REAL = Date.now();

function owner(h: RunsHarness) {
  const pg = h.t.pg;
  if (!pg) throw new Error("db");
  return pg.owner;
}

async function workspaceLeft(h: RunsHarness, id: string): Promise<boolean> {
  const rows = await owner(h)
    .db.select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, id));
  return rows.length > 0;
}

/** Due rows of the post run now (the outbox's schedule is the database's clock). */
async function due(h: RunsHarness) {
  await owner(h)
    .db.update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

describe("a judge batch POSTed late under a fresh slot, then the hourly purge of its expired workspace", () => {
  const script = paypalScript({ parked: [] });
  let h: RunsHarness;
  const sent: { at: number; status: number }[] = [];
  let postedAt = 0;
  let batchId = "";
  const peek = () => judgeRail(h.t.deps, { workspaceId: h.world.workspaceId, sessionId: null, step: "post" });

  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, clock: new Date(REAL - 25 * H).toISOString() });
    h.paypal?.use(
      http.post(POSTS, () => {
        sent.push({ at: h.t.clock.nowMs(), status: 201 });
      }),
    );
    await resolveAll(h);
    await signBoth(h);
    // the rows are written 25 h ago; PayPal refuses the credentials twice (unresolved: nothing created)
    for (let i = 0; i < 2; i++) {
      h.paypal?.use(
        http.post(
          POSTS,
          () => {
            sent.push({ at: h.t.clock.nowMs(), status: 401 });
            return paypalError(401, "AUTHENTICATION_FAILURE");
          },
          { once: true },
        ),
      );
    }
    await runQueued(h, "postPayoutBatch");
    // an outage held for a day: the post resumes 20 minutes ago (24 h 40 min after its write), on a fresh reading
    h.t.clock.set(new Date(REAL - 20 * MIN));
    await recordBalanceReading(h.t.deps.db, {
      rail: "sandbox",
      availableCents: 100_000_000,
      asOf: h.t.clock.now(),
      source: "searchBalances",
    });
    await due(h);
    await runQueued(h, "postPayoutBatch");
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    batchId = batch?.id as string;
    postedAt = h.t.clock.nowMs();
    // PayPal settles every item (no parked receiver)
    await settleBatch(h.t.deps, { batchId, n: 1 }, { workspaceId: h.world.workspaceId });
    // the session's 24 h run out; seven quiet minutes pass after the POST's PayPal calls
    await setWorkspaceExpiry(owner(h).sql, h.world.workspaceId, new Date(Date.now() - MIN));
    await owner(h).sql`update paypal_calls set at = at - interval '30 minutes',
                 responded_at = responded_at - interval '30 minutes' where workspace_id = ${h.world.workspaceId}`;
  }, 120_000);
  afterAll(async () => h?.close());

  it("the POST went out late, once, under a fresh slot, and the money settled", async () => {
    expect(sent.map((s) => s.status)).toEqual([401, 401, 201]);
    expect(Math.abs((sent[2]?.at ?? 0) - (REAL - 20 * MIN))).toBeLessThan(MIN);
    const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
    expect(run?.state).toBe("SETTLED");
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    expect((await peek()).quota.used24h).toBe(1);
  });

  it("the purge keeps the workspace while C-21 counts its batch: 2 h and 23 h after the POST it is still counted", async () => {
    const out = await purgeExpiredJudgeWorkspaces(h.t.deps.db, 20, [h.world.workspaceId]);
    expect(out).toEqual({ purged: [], deferred: [h.world.workspaceId] });
    expect(await workspaceLeft(h, h.world.workspaceId)).toBe(true);
    for (const after of [0, 2 * H, 23 * H, 24 * H]) {
      expect(await postsInLast24h(h.t.deps, new Date(postedAt + after))).toBe(1);
    }
    // the judge counters read the ledger: unchanged
    expect((await peek()).quota.used24h).toBe(1);
    // and the spend still subtracts the batch from the reading taken just before its POST
    const est = await estimateBalance(h.t.deps.db, "sandbox", h.t.clock.now());
    expect(est.spentCents).toBeGreaterThan(0);
  });

  it("once nothing counts the batch any more (its slots, marks and write a day and more back), the purge removes it", async () => {
    // the database's clock cannot move: age every row of this run back 27 h instead (past C-21's 24 h and a lane
    // lease, and past the oldest reading the spend counts from)
    const back = sql`interval '27 hours'`;
    await owner(h).db.execute(sql`
      update reconciliation_reports set window_end = window_end - ${back}
       where workspace_id is null
         and (summary->>'runId' = ${h.world.runId} or summary->>'batchId' = ${batchId})`);
    await owner(h).db.execute(sql`
      update payout_batches set submitted_at = submitted_at - ${back} where id = ${batchId}`);
    const out = await purgeExpiredJudgeWorkspaces(h.t.deps.db, 20, [h.world.workspaceId]);
    expect(out).toEqual({ purged: [h.world.workspaceId], deferred: [] });
    expect(await workspaceLeft(h, h.world.workspaceId)).toBe(false);
    expect(await postsInLast24h(h.t.deps, new Date(postedAt))).toBe(0);
  });
});

const TOTAL = 4_100;
const purgeOnly = (h: RunsHarness, workspaceId: string) =>
  purgeExpiredJudgeWorkspaces(h.t.deps.db, 20, [workspaceId]);

/**
 * An expired judge workspace with one batch written `writtenAgo` (default 30 h) before now, and the system ledger
 * rows given: a `batch_sent` mark, a `batch_posted` mark (PayPal named it), a judge slot of its run (settled as given).
 */
async function expiredWithBatch(
  h: RunsHarness,
  o: {
    kind?: "primary" | "reroute";
    status?: "SUCCESS" | "DENIED";
    provenance?: "live" | "replay";
    writtenAgo?: number;
    sentAgo?: number;
    postedAgo?: number;
    slot?: { ago: number; outcome: "posted" | "denied" };
  } = {},
) {
  const fx = await h.t.fixture({ kind: "judge", withRun: true });
  const status = o.status ?? "SUCCESS";
  const provenance = o.provenance ?? "live";
  const [row] = await owner(h)
    .db.insert(schema.payoutBatches)
    .values({
      workspaceId: fx.workspaceId,
      runId: fx.runId as string,
      senderBatchId: `2026A-purge-${randomUUID()}`,
      requestId: "e".repeat(64),
      batchSha256: "f".repeat(64),
      kind: o.kind ?? "reroute",
      status,
      itemCount: 1,
      totalCents: BigInt(TOTAL),
      currency: "USD",
      provenance,
      paypalBatchId:
        status === "DENIED"
          ? null
          : `${provenance === "replay" ? "RPLY" : "PBPURGE"}${randomUUID().slice(0, 8)}`,
      submittedAt: new Date(Date.now() - (o.writtenAgo ?? 30 * H)),
    })
    .returning({ id: schema.payoutBatches.id });
  const id = row?.id as string;
  const mark = async (ago: number, summary: Record<string, unknown>) => {
    const [r] = await owner(h)
      .db.insert(schema.reconciliationReports)
      .values({ kind: "balance", windowEnd: new Date(Date.now() - ago), summary: { v: 1, ...summary } })
      .returning({ id: schema.reconciliationReports.id });
    return r?.id as string;
  };
  if (o.sentAgo !== undefined) await mark(o.sentAgo, { entry: "batch_sent", batchId: id, provenance });
  if (o.postedAgo !== undefined)
    await mark(o.postedAgo, { entry: "batch_posted", batchId: id, rail: "sandbox" });
  if (o.slot) {
    const slotId = await mark(o.slot.ago, {
      entry: "judge_post",
      runId: fx.runId,
      workspaceId: fx.workspaceId,
      sessionId: null,
      coded: false,
      amountCents: TOTAL,
      rail: "sandbox",
    });
    await mark(o.slot.ago, {
      entry: "judge_post_settled",
      reservationId: slotId,
      runId: fx.runId,
      outcome: o.slot.outcome,
    });
  }
  await setWorkspaceExpiry(owner(h).sql, fx.workspaceId, new Date(Date.now() - H));
  return { workspaceId: fx.workspaceId, batchId: id };
}

describe("a judge workspace's re-route (marked sent at a late POST, or named by PayPal after a reading)", () => {
  const script = paypalScript();
  let h: RunsHarness;

  beforeAll(async () => {
    // no reading at the start: each test records the one it needs
    h = await startRuns({ paypal: script.handlers, clock: new Date(REAL).toISOString(), balanceCents: null });
  });
  afterAll(async () => h?.close());

  const expiredWithReroute = (marks: { sentAgo?: number; postedAgo?: number }) => expiredWithBatch(h, marks);

  it("C-21 counts a re-route marked sent 23 h ago: the purge keeps it, and the count holds", async () => {
    const w = await expiredWithReroute({ sentAgo: 23 * H, postedAgo: 23 * H });
    const before = await postsInLast24h(h.t.deps, new Date());
    expect(before).toBeGreaterThanOrEqual(1);
    const out = await purgeExpiredJudgeWorkspaces(h.t.deps.db, 20, [w.workspaceId]);
    expect(out).toEqual({ purged: [], deferred: [w.workspaceId] });
    expect(await postsInLast24h(h.t.deps, new Date())).toBe(before);
  });

  it("the spend counts a re-route PayPal named 25 h ago after a reading 25.5 h old: the purge keeps it", async () => {
    await recordBalanceReading(h.t.deps.db, {
      rail: "sandbox",
      availableCents: 100_000_000,
      asOf: new Date(Date.now() - 25.5 * H),
      source: "searchBalances",
    });
    const w = await expiredWithReroute({ sentAgo: 25 * H, postedAgo: 25 * H });
    const spent = (await estimateBalance(h.t.deps.db, "sandbox", new Date())).spentCents;
    expect(spent).toBeGreaterThanOrEqual(TOTAL);
    const out = await purgeExpiredJudgeWorkspaces(h.t.deps.db, 20, [w.workspaceId]);
    expect(out).toEqual({ purged: [], deferred: [w.workspaceId] });
    expect((await estimateBalance(h.t.deps.db, "sandbox", new Date())).spentCents).toBe(spent);
  });

  it("a re-route no count reads any more (sent 25 h ago, named 27 h ago, written 30 h ago) is purged", async () => {
    expect(JUDGE_QUOTA.readingMaxAgeMs).toBeLessThan(27 * H);
    const w = await expiredWithReroute({ sentAgo: 25 * H, postedAgo: 27 * H });
    const out = await purgeExpiredJudgeWorkspaces(h.t.deps.db, 20, [w.workspaceId]);
    expect(out).toEqual({ purged: [w.workspaceId], deferred: [] });
  });
});

describe("the purge waits for the spend from the latest reading on the rail, whatever its age", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let w: { workspaceId: string; batchId: string };

  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, clock: new Date(REAL).toISOString(), balanceCents: null });
    // the nightly reconciliation has not run for 30 h: the latest reading is that old (the judge rail replays, and
    // the service's floor guard still reads it)
    await recordBalanceReading(h.t.deps.db, {
      rail: "sandbox",
      availableCents: 100_000_000,
      asOf: new Date(Date.now() - 30 * H),
      source: "searchBalances",
    });
  });
  afterAll(async () => h?.close());

  it("a re-route PayPal named 27 h ago, after that reading: the floor guard subtracts it, so the purge keeps it", async () => {
    w = await expiredWithBatch(h, { writtenAgo: 31 * H, postedAgo: 27 * H });
    const before = await estimatedBalanceCents(h.t.deps);
    expect(before).toBe(BigInt(100_000_000 - TOTAL));
    expect(await purgeOnly(h, w.workspaceId)).toEqual({ purged: [], deferred: [w.workspaceId] });
    expect(await estimatedBalanceCents(h.t.deps)).toBe(before);
  });

  it("once a newer reading lands after PayPal named it, no count reads the batch: the purge removes it", async () => {
    await recordBalanceReading(h.t.deps.db, {
      rail: "sandbox",
      availableCents: 99_000_000,
      asOf: new Date(Date.now() - 20 * H),
      source: "searchBalances",
    });
    expect(await estimatedBalanceCents(h.t.deps)).toBe(99_000_000n);
    expect(await purgeOnly(h, w.workspaceId)).toEqual({ purged: [w.workspaceId], deferred: [] });
  });
});

describe("the purge waits for C-21 alone: no reading, no PayPal name, a slot or a sent mark 23 h old", () => {
  const script = paypalScript();
  let h: RunsHarness;
  const past = 24 * H + JUDGE_QUOTA.restampAfterMs + MIN;

  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, clock: new Date(REAL).toISOString(), balanceCents: null });
  });
  afterAll(async () => h?.close());

  it("a primary batch written 30 h ago and DENIED on a fresh slot 23 h ago: kept, then purged once that slot ages out", async () => {
    const kept = await expiredWithBatch(h, {
      kind: "primary",
      status: "DENIED",
      slot: { ago: 23 * H, outcome: "denied" },
    });
    expect(await batchesStillCounted(h.t.deps.db, kept.workspaceId, new Date())).toBe(true);
    expect(await purgeOnly(h, kept.workspaceId)).toEqual({ purged: [], deferred: [kept.workspaceId] });
    const aged = await expiredWithBatch(h, {
      kind: "primary",
      status: "DENIED",
      slot: { ago: past, outcome: "denied" },
    });
    expect(await purgeOnly(h, aged.workspaceId)).toEqual({ purged: [aged.workspaceId], deferred: [] });
  });

  it("a re-route written 30 h ago, marked sent 23 h ago and refused (never named): kept, then purged once the mark ages out", async () => {
    const kept = await expiredWithBatch(h, { status: "DENIED", sentAgo: 23 * H });
    expect(await batchesStillCounted(h.t.deps.db, kept.workspaceId, new Date())).toBe(true);
    expect(await purgeOnly(h, kept.workspaceId)).toEqual({ purged: [], deferred: [kept.workspaceId] });
    const aged = await expiredWithBatch(h, { status: "DENIED", sentAgo: past });
    expect(await purgeOnly(h, aged.workspaceId)).toEqual({ purged: [aged.workspaceId], deferred: [] });
  });

  it("a replay batch weighs on no count: a workspace whose only batch is a replay written 25 h ago is purged", async () => {
    const w = await expiredWithBatch(h, { kind: "primary", provenance: "replay", writtenAgo: 25 * H });
    expect(await batchesStillCounted(h.t.deps.db, w.workspaceId, new Date())).toBe(false);
    expect(await purgeOnly(h, w.workspaceId)).toEqual({ purged: [w.workspaceId], deferred: [] });
  });
});
