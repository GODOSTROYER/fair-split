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
//   - `judge_post`          a live-post reservation: the run, its session, its amount, its rail;
//   - `judge_post_settled`  what became of a reservation (posted, denied by PayPal, or never posted);
//   - `judge_code`          a session that unlocked the judge-code bucket (`recordJudgeCode`).
// `reserveLivePost` decides and reserves in ONE transaction under one advisory lock, counting reservations
// still in flight, so two judges at cap−1 can never both post. The steps before the post only peek
// (`judgeRail`): they ask whether a slot is still left, and the post is the step that takes it.
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

export type LivePostOutcome = "posted" | "denied" | "not_posted";

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
  outcome: LivePostOutcome | null;
}

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
    outcome:
      r.outcome === "posted" || r.outcome === "denied" || r.outcome === "not_posted" ? r.outcome : null,
  }));
}

/**
 * Every live post on this rail at or after `since` (ever, when null; a post in the very instant of a reading
 * counts, so the estimate errs low), each run once: its batch total when the
 * batch row exists (any workspace: they all pay from the one business account), else the amount its live
 * reservation set aside (in flight, or posted from a workspace the purge has since removed). DENIED
 * batches and reservations settled `denied` or `not_posted` moved no money.
 */
export async function liveSpend(db: DbOrTx, rail: RailLabel, since: Date | null): Promise<number> {
  const reservations = await readReservations(db, { since });
  const reserved = new Map<string, number>();
  for (const r of reservations) {
    if (r.rail !== rail || r.outcome === "denied" || r.outcome === "not_posted") continue;
    reserved.set(r.runId, Math.max(reserved.get(r.runId) ?? 0, r.amountCents));
  }
  const batches = (await db.execute(sql`
    select pb.run_id::text as run_id, coalesce(sum(pb.total_cents), 0)::bigint as total
      from payout_batches pb
     where pb.status <> 'DENIED' and pb.provenance = ${provenanceOf(rail)}
       ${since ? sql`and pb.submitted_at >= ${since.toISOString()}::timestamptz` : sql``}
     group by pb.run_id`)) as unknown as { run_id: string; total: string | number }[];
  const posted = new Map(batches.map((b) => [b.run_id, asInt(b.total)]));
  let spent = 0;
  for (const runId of new Set([...reserved.keys(), ...posted.keys()])) {
    spent += posted.get(runId) ?? reserved.get(runId) ?? 0;
  }
  return spent;
}

/** The balance a live post would draw on, from the judge quota ledger (see the header). */
export async function estimateBalance(db: DbOrTx, rail: RailLabel, now: Date): Promise<BalanceEstimate> {
  const reading = await latestBalanceReading(db, rail);
  const age = reading ? now.getTime() - reading.asOf.getTime() : Number.POSITIVE_INFINITY;
  if (reading && age <= JUDGE_QUOTA.readingMaxAgeMs) {
    const spentCents = await liveSpend(db, rail, reading.asOf);
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
  const spentCents = await liveSpend(db, rail, null);
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
 * Live judge posts in the rolling 24 h: every reservation not settled `not_posted` (so posts still in
 * flight count), plus any judge batch posted without one (a safety net: older rows, or a caller that
 * skipped the protocol), each run once. A replayed batch (provenance `replay`) reached no one: never a post.
 */
async function countPosts(
  db: DbOrTx,
  o: { sessionId: string | null; now: Date; excludeRunId?: string },
): Promise<PostCounts> {
  const hourStart = Math.floor(o.now.getTime() / 3_600_000) * 3_600_000;
  const dayAgo = new Date(o.now.getTime() - 86_400_000);
  const runs = new Map<string, { at: number; sessionId: string | null; coded: boolean }>();
  for (const r of await readReservations(db, { since: dayAgo })) {
    if (r.outcome === "not_posted" || r.runId === o.excludeRunId) continue;
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
       and pb.submitted_at > ${dayAgo.toISOString()}::timestamptz
       and not exists (
         select 1 from reconciliation_reports r
          where r.kind = ${LEDGER_KIND} and r.workspace_id is null and r.summary->>'entry' = 'judge_post'
            and r.summary->>'runId' = pb.run_id::text)`)) as unknown as {
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
  const balance = await estimateBalance(db, deps.paypal.label, o.now);
  const counts = await countPosts(db, {
    sessionId: o.sessionId,
    now: o.now,
    ...(o.excludeRunId ? { excludeRunId: o.excludeRunId } : {}),
  });
  return {
    killPaypalLive: flags.kill_paypal_live.on,
    simulatorStub: deps.paypal.simulator?.kind === "stub",
    circuitOpenUntil: limiter.circuitOpenUntil,
    balance,
    ...counts,
    coded: o.sessionId !== null && (await isCodedSession(db, o.sessionId)),
  };
}

/** The live-or-replay decision for one step of a judge workspace, read fresh. A peek: it reserves nothing. */
export async function judgeRail(
  deps: AppDeps,
  o: { workspaceId: string; sessionId: string | null; step: JudgeStep },
): Promise<RailDecision> {
  const now = deps.clock.now();
  const facts = await quotaFacts(deps, { workspaceId: o.workspaceId, sessionId: o.sessionId, now });
  return decideRail(facts, now, o.step, deps.paypal.label);
}

/** The run's newest reservation that still holds a slot (not settled `not_posted`), if any. */
async function heldReservation(db: DbOrTx, runId: string): Promise<ReservationRow | null> {
  const mine = await readReservations(db, { runId });
  return mine.filter((r) => r.outcome !== "not_posted").at(-1) ?? null;
}

/**
 * The binding decision for a judge run's post: decides and reserves in one transaction under the quota
 * lock, so concurrent posts (in any process) are counted against each other. Idempotent per run: a
 * retried post keeps the slot it holds, and only a kill switch, the simulator or the circuit can still turn
 * it to replay. Call it while holding the live lane (`beginLiveStep` does both); settle it afterwards.
 */
export async function reserveLivePost(
  deps: AppDeps,
  o: { workspaceId: string; sessionId: string | null; runId: string; amountCents: number },
): Promise<{ decision: RailDecision; reservation: LivePostReservation | null }> {
  if (!Number.isSafeInteger(o.amountCents) || o.amountCents < 0) {
    throw new RangeError("reserveLivePost: amountCents is the batch total in whole cents");
  }
  const now = deps.clock.now();
  const rail = deps.paypal.label;
  return deps.db.transaction(async (tx) => {
    await lockQuota(tx);
    const facts = await quotaFacts(
      deps,
      { workspaceId: o.workspaceId, sessionId: o.sessionId, now, excludeRunId: o.runId },
      tx,
    );
    const decision = decideRail(facts, now, "post", rail);
    const held = await heldReservation(tx, o.runId);
    if (held) {
      if (decision.mode === "live" || isQuotaReplay(decision)) {
        return { decision: liveDecision(rail, decision.quota), reservation: held };
      }
      return { decision, reservation: null };
    }
    if (decision.mode === "replay") return { decision, reservation: null };
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
 * What became of a reservation: `posted` (PayPal created the batch), `denied` (PayPal refused it
 * synchronously: it counts toward the caps, not the balance) or `not_posted` (nothing reached PayPal, e.g.
 * the I4 refusal or a kill switch: the slot is free again). The first settlement stands.
 */
export async function settleLivePost(
  deps: Pick<AppDeps, "db" | "clock">,
  o: { reservationId: string; outcome: LivePostOutcome },
): Promise<{ settled: boolean; outcome: LivePostOutcome }> {
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
      outcome: LivePostOutcome | null;
    }[];
    const row = rows[0];
    if (!row) throw new RangeError("settleLivePost: no such reservation");
    if (row.outcome) return { settled: false, outcome: row.outcome };
    await tx.insert(schema.reconciliationReports).values({
      kind: LEDGER_KIND,
      windowEnd: deps.clock.now(),
      summary: {
        v: 1,
        entry: "judge_post_settled",
        reservationId: o.reservationId,
        runId: row.run_id,
        outcome: o.outcome,
      },
    });
    return { settled: true, outcome: o.outcome };
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
