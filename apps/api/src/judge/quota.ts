// Live or replay (S3.9, plan "Limits"): a judge's PayPal steps run live only while every guard allows it,
// and over quota they replay, labelled, never blocked (the rules require access "without any restriction"
// until 15 Dec). "Live" means a run that posts a real (or, in simulator mode, a simulated) payout batch.
//
//   kill_paypal_live (workspace or FS_KILL) · simulator stub · the 429 circuit      → replay every step
//   no fresh balance reading (sandbox) · balance below US$10,000 · today's cap
//   · 3 per clock hour · 3 per judge cookie · the public third                      → replay the run
//
// Daily live posts = min(40, floor((estimated balance − US$10,000) / (US$345 × days left to 15 Dec))): a
// third for the public, the rest for judge-code sessions.
//
// Everything that decides a live post is durable and shared by every process: the JUDGE QUOTA LEDGER is a
// set of system rows (`reconciliation_reports`, kind `balance`, no workspace), so the hourly purge of a
// judge workspace never hands quota, spend or a judge code back:
//   - `reading`             a balance reading (`recordBalanceReading`, after PayPal's searchBalances);
//   - `judge_post`          a live-post reservation (a slot): the run, its session, its amount, its rail;
//   - `judge_post_settled`  what became of a reservation (posted, denied by PayPal, never posted, or superseded by a
//                           fresh slot of the same run dated at a later POST);
//   - `judge_code`          a session that unlocked the judge-code bucket (`recordJudgeCode`);
//   - `batch_posted`        PayPal named a live batch then (`recordBatchPosted`): the spend dates it by its POST;
//   - `batch_sent`          a written batch resumed outside the judge quota went out then (`countResumedSend`):
//                           C-21 counts it from that POST.
// `reserveLivePost` decides and reserves in ONE transaction under one advisory lock, counting reservations
// still in flight, so two judges at cap−1 can never both post. The steps before the post only peek
// (`judgeRail`): they ask whether a slot is still left, and the post is the step that takes it.
//
// SEND TIME. A post is counted from its slot, so a slot is dated within one lane lease of the POST it carries
// (`JUDGE_QUOTA.restampAfterMs`): the run's slot carries a retry only while it is that young and in the same clock
// hour; a post that resumes later (a pace, a kill switch, the circuit, an outage) takes a FRESH slot dated now, checked
// against every cap with its run's own slots left out, or waits; the older slot is settled `superseded`. Every count
// looks back 24 h plus that lease and takes each run once, and the spend takes each run through its newest slot.
// C-21 and the spend read the batch rows too, so the hourly purge keeps a judge workspace while either still counts
// one of its batches (`batchesStillCounted`): a POST sent late is counted from then, not from its write.
//
// LOCK ORDER, everywhere both are held: the quota lock (`fs:judge-quota`), then the spend lock (`fs:payout-spend`,
// money/payouts.ts `SPEND_LOCK`): lane → quota → spend → workspace → rows. A resumed post's fresh slot holds both (its
// C-21 count and its insert); the service's spend guard and `countResumedSend` hold only the spend lock, and
// `settleLivePost` only the quota lock, so nothing waits for the quota lock while holding the spend lock.
//
// The balance is the latest reading on this rail minus every live post since it. On the sandbox rail a
// reading older than 26 h is no reading: PayPal steps replay (`balance_unknown`) instead of assuming the
// opening US$100,000. On the simulated rail, before any reading, it is the simulator's opening balance
// minus every simulated post ever (labelled `simulator_opening`).
//
// `decideRail` is pure (property-tested); the facts are read fresh (flags are never cached).
import { createLimiter, type Db, type DbOrTx, readFlags, schema } from "@fairsplit/db";
import { eq, sql } from "drizzle-orm";
import { killEnv } from "../env.js";
import type { AppDeps } from "../lib/context.js";
import type { RailLabel } from "../paypal/mode.js";
import { LANE_DEFAULTS } from "./lane.js";

export const JUDGE_QUOTA = {
  dailyMax: 40,
  /** Below this, PayPal steps replay (register C-21; plan "replay floor US$10,000"). */
  replayFloorCents: 1_000_000,
  /** Net cost of one live run (US$368.39 posted, minus Rhea's return, plus fees ≈ US$345). */
  perRunCents: 34_500,
  /** The judging period ends on 15 Dec (UTC date). */
  judgingEnds: "2026-12-15",
  hourlyMax: 3,
  perSession24h: 3,
  /** One third of the daily cap is the public bucket; the rest is for judge-code sessions. */
  publicShareDivisor: 3,
  /**
   * The simulator's opening business balance (register §8's US$100,000), used on the simulated rail only
   * until a reading exists. The sandbox reserve is never assumed: it needs a fresh reading.
   */
  simulatorOpeningCents: 10_000_000,
  /** A balance reading older than this is no reading (the nightly reconciliation, plus two hours' slack). */
  readingMaxAgeMs: 26 * 3_600_000,
  /**
   * A post is counted from its slot, so the slot its run holds carries a POST only while it is younger than this,
   * and only in the clock hour it was taken: the live lane's lease (90 s), the longest one burst holds the lane
   * without renewing. The slot is taken in the burst that posts under it, so a retry this soon (the limiter's window,
   * an unanswered POST, refused credentials; the service's own retries take 13 s) is that burst in effect. A post that
   * resumes later reaches PayPal now: it takes a fresh slot dated now, checked against every cap, or waits. Every
   * count looks back 24 h plus this, so a POST up to a lease after its slot is counted for the 24 h after it.
   */
  restampAfterMs: LANE_DEFAULTS.leaseMs,
} as const;

export type JudgeStep = "session" | "invoice" | "fund" | "post" | "cancel" | "resend";

/** Steps whose live-ness depends on the payout quota (a live run is one that posts a batch). */
const QUOTA_STEPS = new Set<JudgeStep>(["session", "invoice", "fund", "post"]);

export const REPLAY_REASONS = [
  "kill_switch",
  "simulator_not_running",
  "circuit_open",
  "lane_full",
  "balance_unknown",
  "balance_low",
  "daily_cap",
  "hourly_cap",
  "session_cap",
  "public_share",
] as const;
export type ReplayReason = (typeof REPLAY_REASONS)[number];

/** Reasons that bind a run before its post; a run that already holds a reservation is past them. */
const QUOTA_REASONS = new Set<ReplayReason>([
  "balance_unknown",
  "balance_low",
  "daily_cap",
  "hourly_cap",
  "session_cap",
  "public_share",
]);

export const REPLAY_COPY: Readonly<Record<ReplayReason, string>> = {
  kill_switch: "PayPal calls are paused by the kill switch",
  simulator_not_running: "the PayPal simulator is not running",
  circuit_open: "PayPal's sandbox is pacing us",
  lane_full: "too many live runs are waiting",
  balance_unknown: "the sandbox balance has not been read in the last day",
  balance_low: "the sandbox balance is low",
  daily_cap: "today's live payouts are used up",
  hourly_cap: "this hour's live payouts are used up",
  session_cap: "you have used your three live payouts today",
  public_share: "today's public live payouts are used up",
};

export const BALANCE_SOURCES = ["reading", "simulator_opening", "unknown"] as const;

export interface BalanceEstimate {
  /** Null when nothing is known: no fresh reading on the sandbox rail (PayPal steps replay). */
  cents: number | null;
  /**
   * reading: the latest reading on this rail minus every live post since it; simulator_opening: the
   * simulator's opening balance minus every simulated post (no reading yet); unknown: no fresh reading.
   */
  source: (typeof BALANCE_SOURCES)[number];
  /** When the reading was taken (null without one). */
  at: Date | null;
  /** What was subtracted: the live posts since the reading (or since the simulator opened). */
  spentCents: number;
}

export interface QuotaFacts {
  killPaypalLive: boolean;
  /**
   * The co-op's own pause (kill_payouts), which the service reads before every POST. `decideRail` leaves it to the
   * service; a resumed post waits it out before it takes a slot (`judgeRail`, `reserveLivePost` with `resume`).
   */
  killPayouts?: boolean;
  simulatorStub: boolean;
  circuitOpenUntil: Date | null;
  balance: BalanceEstimate;
  /** Live judge posts in the rolling 24 h, all sessions (reservations in flight included). */
  posts24h: number;
  /** Live judge posts since the start of the current UTC hour. */
  postsThisHour: number;
  /** This session's live posts in the rolling 24 h. */
  sessionPosts24h: number;
  /** Live posts in the rolling 24 h by sessions without a judge code. */
  publicPosts24h: number;
  /** Whether this session unlocked the judge-code bucket. */
  coded: boolean;
}

export interface QuotaNumbers {
  dailyCap: number;
  used24h: number;
  hourlyCap: number;
  usedThisHour: number;
  sessionCap: number;
  sessionUsed: number;
  publicCap: number;
  publicUsed: number;
  coded: boolean;
  balance: { cents: number | null; source: BalanceEstimate["source"]; at: string | null };
}

export interface RailDecision {
  mode: "live" | "replay";
  reason: ReplayReason | null;
  /** I8: the words the stage shows next to every PayPal step of this run. */
  label: string;
  rail: RailLabel;
  quota: QuotaNumbers;
}

/** Whole days from `today` (YYYY-MM-DD, UTC) to the end of judging, at least 1. */
export function daysLeft(today: string, ends: string = JUDGE_QUOTA.judgingEnds): number {
  const ms = Date.parse(`${ends}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

/** min(40, floor((balance − floor) / (per-run cost × days left))), never below zero. */
export function dailyLivePostCap(balanceCents: number, today: string): number {
  const spare = balanceCents - JUDGE_QUOTA.replayFloorCents;
  if (spare <= 0) return 0;
  const raw = Math.floor(spare / (JUDGE_QUOTA.perRunCents * daysLeft(today)));
  return Math.max(0, Math.min(JUDGE_QUOTA.dailyMax, raw));
}

function liveLabel(rail: RailLabel): string {
  return rail === "sandbox"
    ? "Live in PayPal's sandbox"
    : "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)";
}

/** A live decision with the given quota numbers (a run that already holds its reservation). */
export function liveDecision(rail: RailLabel, quota: QuotaNumbers): RailDecision {
  return { mode: "live", reason: null, label: liveLabel(rail), rail, quota };
}

/** A labelled replay decision. */
export function replayDecision(reason: ReplayReason, rail: RailLabel, quota: QuotaNumbers): RailDecision {
  return { mode: "replay", reason, label: `Replay: ${REPLAY_COPY[reason]}`, rail, quota };
}

/** The decision for one step, from facts read fresh. Pure. */
export function decideRail(f: QuotaFacts, now: Date, step: JudgeStep, rail: RailLabel): RailDecision {
  const today = now.toISOString().slice(0, 10);
  const dailyCap = f.balance.cents === null ? 0 : dailyLivePostCap(f.balance.cents, today);
  const publicCap = Math.floor(dailyCap / JUDGE_QUOTA.publicShareDivisor);
  const quota: QuotaNumbers = {
    dailyCap,
    used24h: f.posts24h,
    hourlyCap: JUDGE_QUOTA.hourlyMax,
    usedThisHour: f.postsThisHour,
    sessionCap: JUDGE_QUOTA.perSession24h,
    sessionUsed: f.sessionPosts24h,
    publicCap,
    publicUsed: f.publicPosts24h,
    coded: f.coded,
    balance: { cents: f.balance.cents, source: f.balance.source, at: f.balance.at?.toISOString() ?? null },
  };
  const replay = (reason: ReplayReason) => replayDecision(reason, rail, quota);
  if (f.killPaypalLive) return replay("kill_switch");
  if (f.simulatorStub) return replay("simulator_not_running");
  if (f.circuitOpenUntil && f.circuitOpenUntil.getTime() > now.getTime()) return replay("circuit_open");
  if (QUOTA_STEPS.has(step)) {
    if (f.balance.cents === null) return replay("balance_unknown");
    if (f.balance.cents < JUDGE_QUOTA.replayFloorCents) return replay("balance_low");
    // the step that posts reserves one; the steps before it check that one is still left for this run
    if (f.posts24h >= dailyCap) return replay("daily_cap");
    if (f.postsThisHour >= JUDGE_QUOTA.hourlyMax) return replay("hourly_cap");
    if (f.sessionPosts24h >= JUDGE_QUOTA.perSession24h) return replay("session_cap");
    if (!f.coded && f.publicPosts24h >= publicCap) return replay("public_share");
  }
  return liveDecision(rail, quota);
}

/** True for a replay that only the quota (not a switch, the simulator or the circuit) decided. */
export function isQuotaReplay(d: RailDecision): boolean {
  return d.mode === "replay" && d.reason !== null && QUOTA_REASONS.has(d.reason);
}

// ---------------------------------------------------------------- the judge quota ledger (durable)

/** `reconciliation_reports.kind` of every judge quota ledger row (always with a null workspace). */
const LEDGER_KIND = "balance" as const;
/** One lock for every reservation and settlement, in every process. */
const QUOTA_LOCK = "fs:judge-quota";
/**
 * C-21's and the floor's lock (money/payouts.ts `SPEND_LOCK`): the service holds it from its C-21 read to its write.
 * Taken after the quota lock when both are held (the header's lock order).
 */
export const PAYOUT_SPEND_LOCK = "fs:payout-spend";

export type LivePostOutcome = "posted" | "denied" | "not_posted";
/**
 * A settlement in the ledger: what became of a post (`LivePostOutcome`), or `superseded`: a fresh slot of the same run
 * (dated at a later POST) carries the post now. A superseded slot is in no spend and holds no post.
 */
export type LivePostSettlement = LivePostOutcome | "superseded";

export interface LivePostReservation {
  id: string;
  runId: string;
  workspaceId: string;
  sessionId: string | null;
  /** Whether the session had unlocked the judge-code bucket when it reserved. */
  coded: boolean;
  amountCents: number;
  rail: RailLabel;
  reservedAt: Date;
}

export interface BalanceReading {
  rail: RailLabel;
  /** The business account's available USD balance, in cents. */
  availableCents: number;
  /** When PayPal (or the simulator) reported it. */
  asOf: Date;
  /** searchBalances (PayPal's Balances API); observed: read by a person from the dashboard. */
  source: "searchBalances" | "observed";
}

const provenanceOf = (rail: RailLabel) => (rail === "simulated" ? "simulated_rail" : "live");

const asInt = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const lockQuota = (tx: DbOrTx) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${QUOTA_LOCK}, 0))`);

/** The spend lock until the transaction ends. Never taken before the quota lock in the same transaction. */
const lockSpend = (tx: DbOrTx) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${PAYOUT_SPEND_LOCK}, 0))`);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Where a rolling 24 h count of slots starts: 24 h before `now`, and a lane lease more, since a slot may carry its
 * POST that long after it was taken (`JUDGE_QUOTA.restampAfterMs`): a post is counted for the 24 h after its POST.
 */
const countFrom = (now: Date) => new Date(now.getTime() - DAY_MS - JUDGE_QUOTA.restampAfterMs);

/**
 * Records a balance reading in the judge quota ledger. The reconciliation that calls PayPal's
 * searchBalances (or the simulator's) writes one at least daily; without a fresh one the sandbox rail replays.
 */
export async function recordBalanceReading(db: DbOrTx, r: BalanceReading): Promise<void> {
  if (!Number.isSafeInteger(r.availableCents)) throw new RangeError("a balance reading is whole cents");
  if (Number.isNaN(r.asOf.getTime())) throw new RangeError("a balance reading needs its as-of time");
  await db.insert(schema.reconciliationReports).values({
    kind: LEDGER_KIND,
    windowEnd: r.asOf,
    summary: {
      v: 1,
      entry: "reading",
      source: r.source,
      rail: r.rail,
      availableCents: r.availableCents,
      currency: "USD",
    },
  });
}

/** The latest reading on this rail (fresh or not). */
export async function latestBalanceReading(
  db: DbOrTx,
  rail: RailLabel,
): Promise<{ availableCents: number; asOf: Date } | null> {
  const rows = (await db.execute(sql`
    select r.summary->>'availableCents' as cents, r.window_end as as_of
      from reconciliation_reports r
     where r.kind = ${LEDGER_KIND} and r.workspace_id is null
       and r.summary->>'entry' = 'reading' and r.summary->>'rail' = ${rail}
       and r.window_end is not null
     order by r.window_end desc, r.created_at desc
     limit 1`)) as unknown as { cents: string | null; as_of: Date | string }[];
  const row = rows[0];
  if (!row || row.cents === null || !/^-?\d+$/.test(row.cents)) return null;
  return { availableCents: asInt(row.cents), asOf: asDate(row.as_of) };
}

interface ReservationRow extends LivePostReservation {
  outcome: LivePostSettlement | null;
}

const SETTLEMENTS = new Set<string>(["posted", "denied", "not_posted", "superseded"]);

/** Reservations (after `since`, of one run, or all), each with its settlement, oldest first. */
async function readReservations(
  db: DbOrTx,
  filter: { since?: Date | null; runId?: string },
): Promise<ReservationRow[]> {
  const rows = (await db.execute(sql`
    select r.id,
           r.summary->>'runId' as run_id,
           r.summary->>'workspaceId' as workspace_id,
           r.summary->>'sessionId' as session_id,
           r.summary->>'coded' as coded,
           r.summary->>'amountCents' as amount_cents,
           r.summary->>'rail' as rail,
           r.window_end as at,
           (select s.summary->>'outcome' from reconciliation_reports s
             where s.kind = ${LEDGER_KIND} and s.workspace_id is null
               and s.summary->>'entry' = 'judge_post_settled'
               and s.summary->>'reservationId' = r.id::text
             order by s.created_at, s.id
             limit 1) as outcome
      from reconciliation_reports r
     where r.kind = ${LEDGER_KIND} and r.workspace_id is null and r.summary->>'entry' = 'judge_post'
       ${filter.since ? sql`and r.window_end >= ${filter.since.toISOString()}::timestamptz` : sql``}
       ${filter.runId ? sql`and r.summary->>'runId' = ${filter.runId}` : sql``}
     order by r.window_end, r.id`)) as unknown as {
    id: string;
    run_id: string;
    workspace_id: string;
    session_id: string | null;
    coded: string | null;
    amount_cents: string | null;
    rail: string;
    at: Date | string;
    outcome: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    workspaceId: r.workspace_id,
    sessionId: r.session_id,
    coded: r.coded === "true",
    amountCents: asInt(r.amount_cents),
    rail: r.rail === "sandbox" ? "sandbox" : "simulated",
    reservedAt: asDate(r.at),
    outcome: r.outcome !== null && SETTLEMENTS.has(r.outcome) ? (r.outcome as LivePostSettlement) : null,
  }));
}

/**
 * Records that PayPal named a batch (created or adopted) now: a `batch_posted` system row, so the spend dates a batch
 * written before a balance reading and posted after it from its POST (`liveSpend`). The repository writes it with
 * the batch's POSTED mark (money/payouts.ts `markPosted`), on a live rail only.
 */
export async function recordBatchPosted(
  db: DbOrTx,
  o: { batchId: string; rail: RailLabel; at: Date },
): Promise<void> {
  await db.insert(schema.reconciliationReports).values({
    kind: LEDGER_KIND,
    windowEnd: o.at,
    summary: { v: 1, entry: "batch_posted", batchId: o.batchId, rail: o.rail },
  });
}

/**
 * Every live post on this rail at or after `since` (ever, when null; a post in the very instant of a reading
 * counts, so the estimate errs low), each run once: its batch total when the batch row counts (any workspace:
 * they all pay from the one business account), else the amount its newest reservation set aside (in flight, or posted
 * from a workspace the purge has since removed). A batch counts when it was written at or after `since`, when PayPal
 * named it at or after `since` (`batch_posted`: rows written before a reading and posted after it are not in that
 * reading), and while it waits to be posted (SUBMITTED, no PayPal id: it may move money after the reading). A run's
 * reservations count through its newest only: a fresh slot supersedes an older one, so a post PayPal denied on it,
 * or a slot settled `not_posted`, leaves nothing set aside. DENIED batches moved no money. `excludeRunId` leaves one
 * run out (a resumed post asking whether its own batch still fits above the floor).
 */
export async function liveSpend(
  db: DbOrTx,
  rail: RailLabel,
  since: Date | null,
  o: { excludeRunId?: string } = {},
): Promise<number> {
  const newest = new Map<string, ReservationRow>();
  for (const r of await readReservations(db, { since })) {
    // oldest first: the run's newest reservation stands
    if (r.rail === rail && r.runId !== o.excludeRunId) newest.set(r.runId, r);
  }
  const reserved = new Map<string, number>();
  for (const [runId, r] of newest) {
    if (r.outcome !== "denied" && r.outcome !== "not_posted" && r.outcome !== "superseded") {
      reserved.set(runId, r.amountCents);
    }
  }
  const at = since?.toISOString();
  const batches = (await db.execute(sql`
    select pb.run_id::text as run_id, coalesce(sum(pb.total_cents), 0)::bigint as total
      from payout_batches pb
     where pb.status <> 'DENIED' and pb.provenance = ${provenanceOf(rail)}
       ${o.excludeRunId ? sql`and pb.run_id <> ${o.excludeRunId}` : sql``}
       ${
         at
           ? sql`and (pb.submitted_at >= ${at}::timestamptz
                      or (pb.status = 'SUBMITTED' and pb.paypal_batch_id is null)
                      or pb.id::text in (
                           select m.summary->>'batchId' from reconciliation_reports m
                            where m.kind = ${LEDGER_KIND} and m.workspace_id is null
                              and m.summary->>'entry' = 'batch_posted'
                              and m.window_end >= ${at}::timestamptz))`
           : sql``
       }
     group by pb.run_id`)) as unknown as { run_id: string; total: string | number }[];
  const posted = new Map(batches.map((b) => [b.run_id, asInt(b.total)]));
  let spent = 0;
  for (const runId of new Set([...reserved.keys(), ...posted.keys()])) {
    spent += posted.get(runId) ?? reserved.get(runId) ?? 0;
  }
  return spent;
}

/**
 * The balance a live post would draw on, from the judge quota ledger (see the header). `excludeRunId`: as if that
 * run had not spent yet (a resumed post's own batch, which it then sets against the floor itself).
 */
export async function estimateBalance(
  db: DbOrTx,
  rail: RailLabel,
  now: Date,
  o: { excludeRunId?: string } = {},
): Promise<BalanceEstimate> {
  const reading = await latestBalanceReading(db, rail);
  const age = reading ? now.getTime() - reading.asOf.getTime() : Number.POSITIVE_INFINITY;
  if (reading && age <= JUDGE_QUOTA.readingMaxAgeMs) {
    const spentCents = await liveSpend(db, rail, reading.asOf, o);
    return {
      cents: reading.availableCents - spentCents,
      source: "reading",
      at: reading.asOf,
      spentCents,
    };
  }
  if (rail === "sandbox") {
    return { cents: null, source: "unknown", at: reading?.asOf ?? null, spentCents: 0 };
  }
  const spentCents = await liveSpend(db, rail, null, o);
  return {
    cents: JUDGE_QUOTA.simulatorOpeningCents - spentCents,
    source: "simulator_opening",
    at: null,
    spentCents,
  };
}

/**
 * Records that a session unlocked the judge-code bucket, in the judge quota ledger (system scope), so a
 * Reset and the purge of its workspace never drop it. Idempotent per session.
 */
export async function recordJudgeCode(db: DbOrTx, o: { sessionId: string; at: Date }): Promise<boolean> {
  if (await isCodedSession(db, o.sessionId)) return false;
  await db.insert(schema.reconciliationReports).values({
    kind: LEDGER_KIND,
    windowEnd: o.at,
    summary: { v: 1, entry: "judge_code", sessionId: o.sessionId },
  });
  return true;
}

/** Whether this session unlocked the judge-code bucket. */
export async function isCodedSession(db: DbOrTx, sessionId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1 as one from reconciliation_reports r
     where r.kind = ${LEDGER_KIND} and r.workspace_id is null
       and r.summary->>'entry' = 'judge_code' and r.summary->>'sessionId' = ${sessionId}
     limit 1`)) as unknown as unknown[];
  return rows.length > 0;
}

/** Every session that unlocked the judge-code bucket (the judge quota ledger's `judge_code` rows). */
export async function codedSessions(db: DbOrTx): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    select distinct r.summary->>'sessionId' as sid from reconciliation_reports r
     where r.kind = ${LEDGER_KIND} and r.workspace_id is null
       and r.summary->>'entry' = 'judge_code'`)) as unknown as { sid: string | null }[];
  return new Set(rows.map((r) => r.sid).filter((s): s is string => !!s));
}

interface PostCounts {
  posts24h: number;
  postsThisHour: number;
  sessionPosts24h: number;
  publicPosts24h: number;
}

/**
 * Live judge posts in the rolling 24 h (from `countFrom`: a lane lease more, the longest a slot carries its POST):
 * every run with a reservation taken in it and not settled `not_posted` (so posts still in flight count), plus any
 * judge batch written live in it whose run has no such reservation in it (a safety net: older rows, a slot an older
 * build freed after the write, or a caller that skipped the protocol). Each run once, however many of its slots are in
 * the window (a fresh slot dated at a resumed POST supersedes the one taken at the write; both may be in it), dated
 * by its newest slot for the clock hour: a slot carries a POST only in its own clock hour. A replayed batch
 * (provenance `replay`) reached no one: never a post.
 */
async function countPosts(
  db: DbOrTx,
  o: { sessionId: string | null; now: Date; excludeRunId?: string },
): Promise<PostCounts> {
  const hourStart = Math.floor(o.now.getTime() / HOUR_MS) * HOUR_MS;
  const from = countFrom(o.now);
  const runs = new Map<string, { at: number; sessionId: string | null; coded: boolean }>();
  for (const r of await readReservations(db, { since: from })) {
    if (r.outcome === "not_posted" || r.runId === o.excludeRunId) continue;
    // oldest first: the run's newest slot in the window stands
    runs.set(r.runId, { at: r.reservedAt.getTime(), sessionId: r.sessionId, coded: r.coded });
  }
  const unreserved = (await db.execute(sql`
    select pb.run_id::text as run_id, pb.submitted_at as at,
           (select ft.session_id::text from frame_tokens ft
             where ft.workspace_id = pb.workspace_id and ft.session_id is not null
             order by ft.created_at limit 1) as sid
      from payout_batches pb
      join workspaces w on w.id = pb.workspace_id
     where w.kind = 'judge' and pb.kind = 'primary' and pb.provenance <> 'replay'
       and pb.submitted_at >= ${from.toISOString()}::timestamptz`)) as unknown as {
    run_id: string;
    at: Date | string;
    sid: string | null;
  }[];
  const coded = unreserved.length > 0 ? await codedSessions(db) : new Set<string>();
  for (const b of unreserved) {
    if (b.run_id === o.excludeRunId || runs.has(b.run_id)) continue;
    runs.set(b.run_id, {
      at: asDate(b.at).getTime(),
      sessionId: b.sid,
      coded: b.sid !== null && coded.has(b.sid),
    });
  }
  const all = [...runs.values()];
  return {
    posts24h: all.length,
    postsThisHour: all.filter((r) => r.at >= hourStart).length,
    sessionPosts24h: o.sessionId ? all.filter((r) => r.sessionId === o.sessionId).length : 0,
    publicPosts24h: all.filter((r) => !r.coded).length,
  };
}

/** Everything `decideRail` needs, read fresh (`db` may be the reservation's transaction). */
export async function quotaFacts(
  deps: AppDeps,
  o: { workspaceId: string; sessionId: string | null; now: Date; excludeRunId?: string },
  db: DbOrTx = deps.db,
): Promise<QuotaFacts> {
  const flags = await readFlags(db, o.workspaceId, killEnv(deps.env));
  // state() only reads (one `execute`), so it runs on the caller's transaction: a reservation holds one
  // connection, not two, while it holds the quota lock
  const limiter = await createLimiter(db as Db).state();
  const balance = await estimateBalance(
    db,
    deps.paypal.label,
    o.now,
    o.excludeRunId ? { excludeRunId: o.excludeRunId } : {},
  );
  const counts = await countPosts(db, {
    sessionId: o.sessionId,
    now: o.now,
    ...(o.excludeRunId ? { excludeRunId: o.excludeRunId } : {}),
  });
  return {
    killPaypalLive: flags.kill_paypal_live.on,
    killPayouts: flags.kill_payouts.on,
    simulatorStub: deps.paypal.simulator?.kind === "stub",
    circuitOpenUntil: limiter.circuitOpenUntil,
    balance,
    ...counts,
    coded: o.sessionId !== null && (await isCodedSession(db, o.sessionId)),
  };
}

/**
 * The live-or-replay decision for one step of a judge workspace, read fresh. A peek: it reserves nothing. A resumed
 * post (`resume`: its batch is written) peeks with its own run left out (`excludeRunId`: its fresh slot would replace
 * its own earlier one, as `reserveLivePost` decides), and waits out kill_payouts too (the service would refuse it).
 */
export async function judgeRail(
  deps: AppDeps,
  o: {
    workspaceId: string;
    sessionId: string | null;
    step: JudgeStep;
    excludeRunId?: string;
    resume?: boolean;
  },
): Promise<RailDecision> {
  const now = deps.clock.now();
  const facts = await quotaFacts(deps, {
    workspaceId: o.workspaceId,
    sessionId: o.sessionId,
    now,
    ...(o.excludeRunId ? { excludeRunId: o.excludeRunId } : {}),
  });
  const decision = decideRail(facts, now, o.step, deps.paypal.label);
  if (o.resume && decision.mode === "live" && facts.killPayouts) {
    return replayDecision("kill_switch", deps.paypal.label, decision.quota);
  }
  return decision;
}

/**
 * The run's slot that still carries its post: its newest reservation not settled `not_posted` or `superseded`, taken
 * less than `JUDGE_QUOTA.restampAfterMs` (one lane lease) before `now` and in the same clock hour, so a POST under it
 * is counted within a lease of when it reaches PayPal, and in its own clock hour. An older one carries nothing: the
 * post takes a fresh slot dated now (`reserveLivePost`), which supersedes it, or waits.
 */
async function heldReservation(db: DbOrTx, runId: string, now: Date): Promise<ReservationRow | null> {
  const mine = await readReservations(db, { runId });
  const held = mine.filter((r) => r.outcome !== "not_posted" && r.outcome !== "superseded").at(-1);
  if (!held) return null;
  const takenAt = held.reservedAt.getTime();
  const sameHour = Math.floor(takenAt / HOUR_MS) === Math.floor(now.getTime() / HOUR_MS);
  return now.getTime() - takenAt < JUDGE_QUOTA.restampAfterMs && sameHour ? held : null;
}

/**
 * C-21's count: the live batches on this rail (batch provenance) in the 24 h before `now`, every workspace, each
 * once. A batch counts from its write (24 h), and from the moments it was sent later, as far back as `countFrom` (a
 * lane lease more: what a slot may carry): a judge primary batch from any live reservation of its run in that window
 * (its resumed POST went out under a fresh slot dated then), any batch from a `batch_sent` mark in it (a re-route
 * resumed later, `countResumedSend`). The two sent-time branches are uncorrelated subqueries over the window's ledger
 * rows (judge runs' slots, a few marks), hashed once per count, so a count stays one pass over the batches.
 * `excludePrimaryOf` leaves out one run's primary batch and `excludeBatchId` one batch (a resumed post asking whether
 * it may go out itself). C-21 reads the batch rows, so the hourly purge keeps a judge workspace while this still
 * counts one of its batches (`batchesStillCounted`).
 */
export async function liveBatchesInLast24h(
  db: DbOrTx,
  provenance: string,
  now: Date,
  o: { excludePrimaryOf?: string; excludeBatchId?: string } = {},
): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as n from payout_batches pb
     where pb.provenance = ${provenance}
       ${o.excludePrimaryOf ? sql`and not (pb.kind = 'primary' and pb.run_id = ${o.excludePrimaryOf})` : sql``}
       ${o.excludeBatchId ? sql`and pb.id <> ${o.excludeBatchId}` : sql``}
       and ${c21Counts(now)}`)) as unknown as {
    n: number | string;
  }[];
  return asInt(row?.n);
}

/** Whether C-21 counts the batch `pb` at `now` (`liveBatchesInLast24h`, any provenance): one predicate for both. */
function c21Counts(now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const from = countFrom(now).toISOString();
  return sql`(pb.submitted_at >= ${dayAgo}::timestamptz
            or (pb.kind = 'primary' and pb.run_id::text in (
                  select r.summary->>'runId' from reconciliation_reports r
                   where r.kind = ${LEDGER_KIND} and r.workspace_id is null and r.summary->>'entry' = 'judge_post'
                     and r.window_end >= ${from}::timestamptz
                     and not exists (
                       select 1 from reconciliation_reports s
                        where s.kind = ${LEDGER_KIND} and s.workspace_id is null
                          and s.summary->>'entry' = 'judge_post_settled'
                          and s.summary->>'reservationId' = r.id::text
                          and s.summary->>'outcome' = 'not_posted')))
            or pb.id::text in (
                  select m.summary->>'batchId' from reconciliation_reports m
                   where m.kind = ${LEDGER_KIND} and m.workspace_id is null and m.summary->>'entry' = 'batch_sent'
                     and m.window_end >= ${from}::timestamptz))`;
}

/**
 * Whether a count still reads a batch row of this workspace at `now` (the purge passes the database's clock): C-21
 * (`liveBatchesInLast24h`: its write, a live slot of its run or a `batch_sent` mark, as far back as 24 h and a lane
 * lease), or the spend (`liveSpend`: its write or PayPal naming it, `batch_posted`, after a balance reading, which is
 * at most `JUDGE_QUOTA.readingMaxAgeMs` old). Both count a batch from its `payout_batches` row, which the purge's
 * cascade deletes, so the hourly purge keeps the workspace while this holds (judge/pool.ts). The ledger rows it reads
 * are system rows: the purge never removes them.
 */
export async function batchesStillCounted(db: DbOrTx, workspaceId: string, now: Date): Promise<boolean> {
  const spendFrom = new Date(now.getTime() - JUDGE_QUOTA.readingMaxAgeMs).toISOString();
  const [row] = (await db.execute(sql`
    select exists (
      select 1 from payout_batches pb
       where pb.workspace_id = ${workspaceId}
         and (${c21Counts(now)}
              or pb.submitted_at >= ${spendFrom}::timestamptz
              or pb.id::text in (
                   select m.summary->>'batchId' from reconciliation_reports m
                    where m.kind = ${LEDGER_KIND} and m.workspace_id is null and m.summary->>'entry' = 'batch_posted'
                      and m.window_end >= ${spendFrom}::timestamptz))) as counted`)) as unknown as {
    counted: boolean;
  }[];
  return row?.counted === true;
}

/** Writes one settlement of a reservation in the judge quota ledger (inside the caller's quota-locked transaction). */
async function writeSettlement(
  tx: DbOrTx,
  at: Date,
  o: { reservationId: string; runId: string; outcome: LivePostSettlement; supersededBy?: string },
): Promise<void> {
  await tx.insert(schema.reconciliationReports).values({
    kind: LEDGER_KIND,
    windowEnd: at,
    summary: {
      v: 1,
      entry: "judge_post_settled",
      reservationId: o.reservationId,
      runId: o.runId,
      outcome: o.outcome,
      ...(o.supersededBy ? { supersededBy: o.supersededBy } : {}),
    },
  });
}

/**
 * The binding decision for a judge run's post: decides and reserves in one transaction under the quota
 * lock, so concurrent posts (in any process) are counted against each other. Idempotent per run: a
 * retried post keeps the slot it holds while that slot still carries its POST (`heldReservation`: taken within one
 * lane lease, in this clock hour), and only a kill switch, the simulator or the circuit can still turn it to replay.
 * Otherwise the post is decided like a new one, its run's own slots left out of every count: a FRESH slot dated now
 * if every quota allows one (the older open slot of the run is settled `superseded`, so the run is one post and one
 * spend), else the replay decision, which `beginLiveStep` turns into a wait for a written batch. A `resume` (its batch
 * already written: same ids, counted from now) also waits out kill_payouts (the service would refuse the POST), and on
 * the sandbox rail must pass the service's spend guard for the write it resumes, which the service checks only at
 * a first write: the balance less its batch stays at or above the floor, and C-21's 40 live batches a day, counted
 * under the spend lock (taken after the quota lock: the header's lock order) together with the slot's insert. A
 * fresh post that will not go live frees a slot an earlier attempt of it took and never used (nothing written).
 * A live decision always carries its reservation. Call it while holding the live lane (`beginLiveStep`
 * does both); settle it afterwards.
 */
export async function reserveLivePost(
  deps: AppDeps,
  o: {
    workspaceId: string;
    sessionId: string | null;
    runId: string;
    amountCents: number;
    /** The run's primary batch is already written live: the post resumes it (never a first write). */
    resume?: boolean;
  },
): Promise<{ decision: RailDecision; reservation: LivePostReservation | null }> {
  if (!Number.isSafeInteger(o.amountCents) || o.amountCents < 0) {
    throw new RangeError("reserveLivePost: amountCents is the batch total in whole cents");
  }
  const now = deps.clock.now();
  const rail = deps.paypal.label;
  return deps.db.transaction(async (tx) => {
    await lockQuota(tx);
    // a resume on the sandbox rail reads the balance and C-21 as the service's guard does, under the spend lock,
    // taken after the quota lock (the header's lock order) and held until its slot is written
    if (o.resume && rail === "sandbox") await lockSpend(tx);
    const facts = await quotaFacts(
      deps,
      { workspaceId: o.workspaceId, sessionId: o.sessionId, now, excludeRunId: o.runId },
      tx,
    );
    const decision = decideRail(facts, now, "post", rail);
    const held = await heldReservation(tx, o.runId, now);
    if (held) {
      if (decision.mode === "live" || isQuotaReplay(decision)) {
        return { decision: liveDecision(rail, decision.quota), reservation: held };
      }
      return { decision, reservation: null };
    }
    const open = (await readReservations(tx, { runId: o.runId })).filter((r) => r.outcome === null);
    const none = async (d: RailDecision) => {
      if (!o.resume && open.length > 0 && !(await writtenLiveBatch(tx, o.runId))) {
        // a fresh post that will not go live: the slot an earlier attempt took sent nothing (no rows are written)
        for (const r of open) {
          await writeSettlement(tx, now, { reservationId: r.id, runId: o.runId, outcome: "not_posted" });
        }
      }
      return { decision: d, reservation: null };
    };
    if (decision.mode === "replay") return none(decision);
    if (o.resume && facts.killPayouts) return none(replayDecision("kill_switch", rail, decision.quota));
    if (o.resume && rail === "sandbox") {
      // the service's guard at a first write, for the write this POST resumes: the floor after this batch…
      const balance = facts.balance.cents;
      if (balance === null || balance - o.amountCents < JUDGE_QUOTA.replayFloorCents) {
        return none(replayDecision("balance_low", rail, decision.quota));
      }
      // …and C-21 (both read under the spend lock, held until this slot is written: the service holds it from its
      // count to its write)
      const others = await liveBatchesInLast24h(tx, provenanceOf(rail), now, { excludePrimaryOf: o.runId });
      if (others >= JUDGE_QUOTA.dailyMax) return none(replayDecision("daily_cap", rail, decision.quota));
    }
    const [row] = await tx
      .insert(schema.reconciliationReports)
      .values({
        kind: LEDGER_KIND,
        windowEnd: now,
        summary: {
          v: 1,
          entry: "judge_post",
          runId: o.runId,
          workspaceId: o.workspaceId,
          sessionId: o.sessionId,
          coded: facts.coded,
          amountCents: o.amountCents,
          rail,
        },
      })
      .returning({ id: schema.reconciliationReports.id });
    if (!row) throw new Error("reserveLivePost: the reservation was not written");
    // the run's older open slot no longer carries its post: this one does (dated at the POST it allows)
    for (const r of open) {
      await writeSettlement(tx, now, {
        reservationId: r.id,
        runId: o.runId,
        outcome: "superseded",
        supersededBy: row.id,
      });
    }
    const reservation: LivePostReservation = {
      id: row.id,
      runId: o.runId,
      workspaceId: o.workspaceId,
      sessionId: o.sessionId,
      coded: facts.coded,
      amountCents: o.amountCents,
      rail,
      reservedAt: now,
    };
    // the post this reservation allows is counted from now on
    const quota = {
      ...decision.quota,
      used24h: decision.quota.used24h + 1,
      usedThisHour: decision.quota.usedThisHour + 1,
      sessionUsed: decision.quota.sessionUsed + (o.sessionId ? 1 : 0),
      publicUsed: decision.quota.publicUsed + (facts.coded ? 0 : 1),
    };
    return { decision: { ...decision, quota }, reservation };
  });
}

/**
 * Whether a judge post may still go live under a slot its run holds (`heldReservation`: one that still carries its
 * POST at `now`), read without the quota lock: a peek, so a resumed post with no slot waits before it takes the lane.
 * The binding answer is `reserveLivePost`'s.
 */
export async function holdsLivePost(db: DbOrTx, runId: string, now: Date): Promise<boolean> {
  return (await heldReservation(db, runId, now)) !== null;
}

/**
 * Whether a slot of the run was settled `posted`: PayPal took the batch, or answered that it holds one under these
 * ids that is not ours (ADOPT_FAILED, which settles `posted`: money may have moved). A written batch that still has no
 * PayPal id after that is ADOPT_FAILED: it needs a person, and is never posted again (money/rail.ts).
 */
export async function postSettled(db: DbOrTx, runId: string): Promise<boolean> {
  return (await readReservations(db, { runId })).some((r) => r.outcome === "posted");
}

/**
 * The run's primary batch as written on a live rail (rows SUBMITTED or further; a replayed batch reached no one),
 * or null while nothing is written.
 */
async function writtenLiveBatch(db: DbOrTx, runId: string): Promise<{ status: string } | null> {
  const rows = (await db.execute(sql`
    select pb.status from payout_batches pb
     where pb.run_id = ${runId} and pb.kind = 'primary' and pb.provenance <> 'replay'
     limit 1`)) as unknown as { status: string }[];
  return rows[0] ?? null;
}

/**
 * What became of a reservation: `posted` (PayPal created the batch), `denied` (PayPal refused it
 * synchronously: it counts toward the caps, not the balance) or `not_posted` (nothing reached PayPal, e.g.
 * the I4 refusal or a kill switch before the write: the slot is free again). The first settlement stands, a
 * `superseded` one included (a fresh slot of the run carries its post; that slot is the one settled).
 *
 * `not_posted` holds only while nothing of the run's batch is written. Once its rows are written live they
 * wait to be posted with the same ids (a written batch is never abandoned, money/resume.ts) and PayPal may
 * already hold them, so a refusal after the write (a kill switch read before the resumed POST, the limiter's
 * window, a re-check that failed) leaves the slot held: nothing is settled (`settled: false, outcome: null`)
 * until PayPal posts or denies the batch. Rows PayPal denied settle `denied`. A held slot carries a retry only for one
 * lane lease in its clock hour (`JUDGE_QUOTA.restampAfterMs`): a later POST goes out under a fresh slot dated then
 * (`reserveLivePost`), which supersedes it. Takes only the quota lock (never the spend lock).
 */
export async function settleLivePost(
  deps: Pick<AppDeps, "db" | "clock">,
  o: { reservationId: string; outcome: LivePostOutcome },
): Promise<{ settled: boolean; outcome: LivePostSettlement | null }> {
  return deps.db.transaction(async (tx) => {
    await lockQuota(tx);
    const rows = (await tx.execute(sql`
      select r.summary->>'runId' as run_id,
             (select s.summary->>'outcome' from reconciliation_reports s
               where s.kind = ${LEDGER_KIND} and s.workspace_id is null
                 and s.summary->>'entry' = 'judge_post_settled'
                 and s.summary->>'reservationId' = r.id::text
               order by s.created_at, s.id limit 1) as outcome
        from reconciliation_reports r
       where r.id = ${o.reservationId} and r.kind = ${LEDGER_KIND} and r.workspace_id is null
         and r.summary->>'entry' = 'judge_post'`)) as unknown as {
      run_id: string;
      outcome: LivePostSettlement | null;
    }[];
    const row = rows[0];
    if (!row) throw new RangeError("settleLivePost: no such reservation");
    if (row.outcome) return { settled: false, outcome: row.outcome };
    let outcome: LivePostOutcome = o.outcome;
    if (outcome === "not_posted") {
      const written = await writtenLiveBatch(tx, row.run_id);
      if (written?.status === "DENIED") outcome = "denied";
      else if (written) return { settled: false, outcome: null };
    }
    await writeSettlement(tx, deps.clock.now(), {
      reservationId: o.reservationId,
      runId: row.run_id,
      outcome,
    });
    return { settled: true, outcome };
  });
}

/**
 * C-21 at the POST of a written batch that resumes outside the judge quota (a re-route, in any workspace; a judge
 * primary batch is counted through its run's fresh slot instead), since the service checks C-21 only at a batch's
 * first write. A batch counted within the last lane lease (written, or marked sent) goes out as it is. Otherwise,
 * under the spend lock, it goes out only while the other live batches of the 24 h are fewer than 40, and is marked
 * sent now (a `batch_sent` system row), so C-21 counts it for the 24 h after this POST (`liveBatchesInLast24h`).
 * Takes only the spend lock, never the quota lock (the header's lock order). Opens its own transaction.
 */
export async function countResumedSend(
  db: Db,
  o: { provenance: string; batchId: string; now: Date },
): Promise<{ ok: true } | { ok: false; count: number }> {
  return db.transaction(async (tx) => {
    const [batch] = (await tx.execute(sql`
      select pb.submitted_at as at,
             (select max(m.window_end) from reconciliation_reports m
               where m.kind = ${LEDGER_KIND} and m.workspace_id is null and m.summary->>'entry' = 'batch_sent'
                 and m.summary->>'batchId' = pb.id::text) as sent
        from payout_batches pb
       where pb.id = ${o.batchId}`)) as unknown as { at: Date | string; sent: Date | string | null }[];
    // nothing written: the service's own guard at the first write applies
    if (!batch) return { ok: true } as const;
    const counted = Math.max(asDate(batch.at).getTime(), batch.sent ? asDate(batch.sent).getTime() : 0);
    if (o.now.getTime() - counted < JUDGE_QUOTA.restampAfterMs) return { ok: true } as const;
    await lockSpend(tx);
    const count = await liveBatchesInLast24h(tx, o.provenance, o.now, { excludeBatchId: o.batchId });
    if (count >= JUDGE_QUOTA.dailyMax) return { ok: false, count } as const;
    await tx.insert(schema.reconciliationReports).values({
      kind: LEDGER_KIND,
      windowEnd: o.now,
      summary: { v: 1, entry: "batch_sent", batchId: o.batchId, provenance: o.provenance },
    });
    return { ok: true } as const;
  });
}

/** True for a workspace of kind `judge` (quotas and the lane apply only there). */
export async function isJudgeWorkspace(db: DbOrTx, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row?.kind === "judge";
}
