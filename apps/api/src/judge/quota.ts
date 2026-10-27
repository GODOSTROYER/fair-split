// Live or replay (S3.9, plan "Limits"): a judge's PayPal steps run live only while every guard allows it,
// and over quota they replay, labelled, never blocked (the rules require access "without any restriction"
// until 15 Dec). "Live" means a run that posts a real (or, in simulator mode, a simulated) payout batch.
//
//   kill_paypal_live (workspace or FS_KILL) · simulator stub · the 429 circuit      → replay every step
//   balance below US$10,000 · today's cap · 3 per clock hour · 3 per judge cookie
//   · the public third                                                             → replay the run
//
// Daily live posts = min(40, floor((estimated balance − US$10,000) / (US$345 × days left to 15 Dec))): a
// third for the public, the rest for judge-code sessions. The balance is the latest balance reading
// (`reconciliation_reports` kind `balance`) minus every batch posted since; before any reading it is the
// business account's opening US$100,000, and the answer says it is an estimate.
//
// `decideRail` is pure (property-tested); `quotaFacts` reads everything fresh (flags are never cached).
import { createLimiter, type Db, readFlags, schema } from "@fairsplit/db";
import { desc, eq, sql } from "drizzle-orm";
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
  /** The co-op business account's opening sandbox balance (register §8), used until a reading exists. */
  openingBalanceCents: 10_000_000,
} as const;

export type JudgeStep = "session" | "invoice" | "fund" | "post" | "cancel" | "resend";

/** Steps whose live-ness depends on the payout quota (a live run is one that posts a batch). */
const QUOTA_STEPS = new Set<JudgeStep>(["session", "invoice", "fund", "post"]);

export type ReplayReason =
  | "kill_switch"
  | "simulator_not_running"
  | "circuit_open"
  | "balance_low"
  | "daily_cap"
  | "hourly_cap"
  | "session_cap"
  | "public_share";

export const REPLAY_COPY: Readonly<Record<ReplayReason, string>> = {
  kill_switch: "PayPal calls are paused by the kill switch",
  simulator_not_running: "the PayPal simulator is not running",
  circuit_open: "PayPal's sandbox is pacing us",
  balance_low: "the sandbox balance is low",
  daily_cap: "today's live payouts are used up",
  hourly_cap: "this hour's live payouts are used up",
  session_cap: "you have used your three live payouts today",
  public_share: "today's public live payouts are used up",
};

export interface BalanceEstimate {
  cents: number;
  source: "reading" | "opening_estimate";
  /** When the reading was taken (null for the opening estimate). */
  at: Date | null;
}

export interface QuotaFacts {
  killPaypalLive: boolean;
  simulatorStub: boolean;
  circuitOpenUntil: Date | null;
  balance: BalanceEstimate;
  /** Live judge posts in the rolling 24 h, all sessions. */
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
  balance: { cents: number; source: BalanceEstimate["source"]; at: string | null };
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

/** The decision for one step, from facts read fresh. Pure. */
export function decideRail(f: QuotaFacts, now: Date, step: JudgeStep, rail: RailLabel): RailDecision {
  const today = now.toISOString().slice(0, 10);
  const dailyCap = dailyLivePostCap(f.balance.cents, today);
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
  const replay = (reason: ReplayReason): RailDecision => ({
    mode: "replay",
    reason,
    label: `Replay: ${REPLAY_COPY[reason]}`,
    rail,
    quota,
  });
  if (f.killPaypalLive) return replay("kill_switch");
  if (f.simulatorStub) return replay("simulator_not_running");
  if (f.circuitOpenUntil && f.circuitOpenUntil.getTime() > now.getTime()) return replay("circuit_open");
  if (QUOTA_STEPS.has(step)) {
    if (f.balance.cents < JUDGE_QUOTA.replayFloorCents) return replay("balance_low");
    // the step that posts consumes one; the steps before it check that one is still left for this run
    if (f.posts24h >= dailyCap) return replay("daily_cap");
    if (f.postsThisHour >= JUDGE_QUOTA.hourlyMax) return replay("hourly_cap");
    if (f.sessionPosts24h >= JUDGE_QUOTA.perSession24h) return replay("session_cap");
    if (!f.coded && f.publicPosts24h >= publicCap) return replay("public_share");
  }
  return { mode: "live", reason: null, label: liveLabel(rail), rail, quota };
}

// ---------------------------------------------------------------- facts (database)

const asInt = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** The latest balance reading minus every batch posted since; the opening balance before any reading. */
export async function estimateBalance(db: Db): Promise<BalanceEstimate> {
  const rr = schema.reconciliationReports;
  const [report] = await db
    .select({ summary: rr.summary, createdAt: rr.createdAt })
    .from(rr)
    .where(eq(rr.kind, "balance"))
    .orderBy(desc(rr.createdAt))
    .limit(1);
  const summary = (report?.summary ?? null) as Record<string, unknown> | null;
  const reading = summary ? (summary.availableCents ?? summary.balanceCents) : undefined;
  const base =
    report && reading !== undefined && Number.isFinite(Number(reading))
      ? { cents: asInt(reading), source: "reading" as const, at: report.createdAt }
      : { cents: JUDGE_QUOTA.openingBalanceCents, source: "opening_estimate" as const, at: null };
  const since = base.at ? sql`and submitted_at > ${base.at.toISOString()}::timestamptz` : sql``;
  // A DENIED batch moved no money; everything else (in flight or settled) is counted as spent.
  const rows = (await db.execute(sql`
    select coalesce(sum(total_cents), 0)::bigint as spent
      from payout_batches where status <> 'DENIED' ${since}`)) as unknown as {
    spent: string | number;
  }[];
  return { ...base, cents: base.cents - asInt(rows[0]?.spent) };
}

/** Session ids that unlocked the judge-code bucket (`judge.code.accepted` ledger entries). */
export async function codedSessions(db: Db): Promise<Set<string>> {
  const le = schema.ledgerEntries;
  const rows = await db
    .select({ sid: sql<string>`${le.payload}->>'sessionId'` })
    .from(le)
    .where(eq(le.kind, "judge.code.accepted"));
  return new Set(rows.map((r) => r.sid).filter(Boolean));
}

/** Everything `decideRail` needs, read fresh. */
export async function quotaFacts(
  deps: AppDeps,
  o: { workspaceId: string; sessionId: string | null; now: Date },
): Promise<QuotaFacts> {
  const db = deps.db;
  const flags = await readFlags(db, o.workspaceId, killEnv(deps.env));
  const limiter = await createLimiter(db).state();
  const balance = await estimateBalance(db);
  const coded = await codedSessions(db);
  const hourStart = new Date(Math.floor(o.now.getTime() / 3_600_000) * 3_600_000);
  const dayAgo = new Date(o.now.getTime() - 86_400_000);
  // Live judge posts: primary batches in judge workspaces. A workspace's owner is the session id on its tokens.
  const rows = (await db.execute(sql`
    with posts as (
      select pb.submitted_at,
             (select ft.session_id from frame_tokens ft
               where ft.workspace_id = pb.workspace_id and ft.session_id is not null
               order by ft.created_at limit 1) as sid
        from payout_batches pb
        join workspaces w on w.id = pb.workspace_id
       where w.kind = 'judge' and pb.kind = 'primary' and pb.submitted_at > ${dayAgo.toISOString()}::timestamptz
    )
    select count(*)::int as posts24h,
           count(*) filter (where submitted_at >= ${hourStart.toISOString()}::timestamptz)::int as this_hour,
           count(*) filter (where sid::text = ${o.sessionId ?? ""})::int as session_posts,
           coalesce(array_agg(sid::text) filter (where sid is not null), '{}') as sids
      from posts`)) as unknown as {
    posts24h: number;
    this_hour: number;
    session_posts: number;
    sids: string[];
  }[];
  const r = rows[0];
  const sids = r?.sids ?? [];
  const publicPosts24h = sids.filter((sid) => !coded.has(sid)).length + ((r?.posts24h ?? 0) - sids.length);
  return {
    killPaypalLive: flags.kill_paypal_live.on,
    simulatorStub: deps.paypal.simulator?.kind === "stub",
    circuitOpenUntil: limiter.circuitOpenUntil,
    balance,
    posts24h: r?.posts24h ?? 0,
    postsThisHour: r?.this_hour ?? 0,
    sessionPosts24h: o.sessionId ? (r?.session_posts ?? 0) : 0,
    publicPosts24h,
    coded: o.sessionId !== null && coded.has(o.sessionId),
  };
}

/** The live-or-replay decision for one step of a judge workspace, read fresh. */
export async function judgeRail(
  deps: AppDeps,
  o: { workspaceId: string; sessionId: string | null; step: JudgeStep },
): Promise<RailDecision> {
  const now = deps.clock.now();
  const facts = await quotaFacts(deps, { workspaceId: o.workspaceId, sessionId: o.sessionId, now });
  return decideRail(facts, now, o.step, deps.paypal.label);
}

/** True for a workspace of kind `judge` (quotas and the lane apply only there). */
export async function isJudgeWorkspace(db: Db, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row?.kind === "judge";
}
