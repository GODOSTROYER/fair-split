// The one protocol for a live judge PayPal step (S3.9, plan "Limits"). The run slice's money tasks
// (agentTurn's invoice turn, ensureInvoice, recordPayment, postPayoutBatch, cancelUnclaimed, reroute) call it
// before any PayPal call, through money/rail.ts (`railForStep`, `railForItem`), which runs a replay on the replay
// rail (paypal/replay.ts):
//
//   const step = await beginLiveStep(deps, { workspaceId, step: "post", runId });
//   switch (step.kind) {
//     case "queued": re-queue the outbox task (retry after step.retryAfterMs; the stage shows step.position)
//     case "replay": replay this step, labelled step.decision.label (provenance "replay")
//     case "live":   let outcome;
//                    try { outcome = await withArmedTamper(deps, { scope, runId }, () => svc.executeApproved(runId)) }
//                    finally { await step.end(settlementOf(outcome)) }   // other steps: step.end()
//   }
//
// The order is the point:
//   1. a fresh peek: a step that would replay anyway (kill switch, simulator, circuit, quota) never queues;
//   2. the lane: first in this process's visible queue (positions and ETA), then across every process
//      through a Postgres advisory lock held on its own connection for the whole burst, so any executor
//      that shares the database honours the single flight (a crashed holder's connection closes and frees it);
//   3. the binding decision WHILE holding the lane: for the post, `reserveLivePost` decides and reserves in
//      one transaction under the quota lock (two judges at cap−1 never both post); for the steps before it,
//      a fresh peek. A replay releases the lane at once. A live post always holds its reservation.
// A RESUMED post (`resume`: its batch is already written live, rows PayPal may hold) is never replayed, and never
// goes live without a slot dated within a lane lease of its POST: it goes live under the slot its run holds while
// that slot still carries it (taken under `JUDGE_QUOTA.restampAfterMs` ago, in this clock hour: a quick retry), or
// under a FRESH slot dated now that every quota still allows with its own run left out (same ids; the floor after its
// batch and C-21's 40 a day too; the older slot superseded), and otherwise it WAITS (`queued`, `waitingFor` the
// reason, re-queued by the caller): a switch (kill_payouts too), the simulator, the circuit, a full lane or a quota.
// Holding the lane, it re-reads its batch first: one PayPal answered while it waited (another executor posted it)
// is `done`, with no slot taken (D5's check, then act, under the lane).
// A post's peek leaves its own run out, as the binding decision does: a slot an earlier attempt of it took (and left
// open, nothing written) is its own place, never a reason to replay it.
// Outside judge workspaces (showcase, real) nothing here applies: the step is live, with no lane and no
// quota, and the run slice's own guards (kill switch, limiter, circuit) stand.
import type { BatchOutcome } from "@fairsplit/paypal-payouts";
import { sql } from "drizzle-orm";
import { sessionOfWorkspace } from "../credentials/issue/tokens.js";
import type { AppDeps } from "../lib/context.js";
import {
  holdsLivePost,
  isJudgeWorkspace,
  isQuotaReplay,
  type JudgeStep,
  judgeRail,
  type LivePostOutcome,
  type LivePostReservation,
  liveDecision,
  type PostAnswered,
  type QuotaNumbers,
  type RailDecision,
  type ReplayReason,
  replayDecision,
  reserveLivePost,
  settleLivePost,
} from "./quota.js";
import { judgeRuntime } from "./runtime.js";

/** The quota numbers of a step outside Judge Mode: none apply. */
export const NO_JUDGE_QUOTA: QuotaNumbers = Object.freeze({
  dailyCap: 0,
  used24h: 0,
  hourlyCap: 0,
  usedThisHour: 0,
  sessionCap: 0,
  sessionUsed: 0,
  publicCap: 0,
  publicUsed: 0,
  coded: false,
  balance: Object.freeze({ cents: null, source: "unknown" as const, at: null }),
});

/** Every process takes this one lock to hold the live lane (session level, on a reserved connection). */
export const LANE_LOCK = "fs:judge-live-lane";
/** A holder that never ends its burst loses the lock after its lease plus this grace. */
const LANE_LOCK_GRACE_MS = 30_000;
/** When another process holds the lane, ask again after this long. */
export const ELSEWHERE_RETRY_MS = 3_000;
/** Replay known waits over 5 s immediately; bound unknown waits to 5 s. Written live posts never replay. */
export const LIVE_LANE_WAIT_MS = 5_000;
/** A resumed post over a quota (daily, per cookie, public, the balance) asks again after this long. */
export const RESUME_QUOTA_WAIT_MS = 15 * 60_000;

/**
 * How long a resumed post waits when it cannot go live now (a written batch is never replayed): PayPal's
 * 6-minute circuit, the next clock hour for the hourly cap, a quarter of an hour for the other quotas (a slot
 * frees as the rolling 24 h moves, a balance reading lands), a minute for a switch, the simulator or a full lane.
 */
export function resumeWaitMs(reason: ReplayReason | null, now: Date): number {
  switch (reason) {
    case "circuit_open":
      return 6 * 60_000;
    case "hourly_cap": {
      const nextHour = (Math.floor(now.getTime() / 3_600_000) + 1) * 3_600_000;
      return Math.max(1_000, nextHour - now.getTime() + 1_000);
    }
    case "daily_cap":
    case "session_cap":
    case "public_share":
    case "balance_unknown":
    case "balance_low":
      return RESUME_QUOTA_WAIT_MS;
    default:
      return 60_000;
  }
}

export interface LiveStepInput {
  workspaceId: string;
  /** The judge session that owns the workspace (read from its tokens when omitted). */
  sessionId?: string | null;
  step: JudgeStep;
  /** The post only: the run it posts. */
  runId?: string;
  /** The post only: the batch total it may spend (the run's on-rail lines when omitted). */
  amountCents?: number;
  /**
   * The post only: its batch is already written live (a POST PayPal paced, refused or never answered), so it is
   * never replayed. It goes live under the slot its run holds while that slot still carries its POST (a lane lease,
   * in its clock hour), else under a fresh slot dated now if the quotas (its own run left out), the floor after its
   * batch and C-21's 40 a day allow it; otherwise it waits (`queued` with `waitingFor`), as it does for a switch, the
   * simulator, the circuit or a full lane.
   */
  resume?: boolean;
}

export type LiveStep =
  | {
      kind: "queued";
      /** Bursts ahead of this one (null when another process holds the lane and positions are unknown). */
      position: number | null;
      etaMs: number;
      retryAfterMs: number;
      /** A resumed post only: why it waits instead of going live (absent while it waits for its turn). */
      waitingFor?: ReplayReason;
    }
  | { kind: "replay"; decision: RailDecision }
  /** A resumed post only: PayPal answered its batch while it waited for the lane; nothing to send, no slot taken. */
  | { kind: "done"; reason: PostAnswered }
  | {
      kind: "live";
      decision: RailDecision;
      /** The post's reservation (null for the other steps, and outside judge workspaces). */
      reservation: LivePostReservation | null;
      leaseUntil: Date;
      /** Extends the lease for a long burst; false when the lane was lost (stop and re-queue). */
      renew(): boolean;
      /**
       * Ends the burst and frees the lane. For the post, the outcome settles its reservation (`settlementOf`);
       * null or omitted keeps the reservation open for the retry that resumes the same batch.
       */
      end(outcome?: LivePostOutcome | null): Promise<void>;
    };

interface HeldLock {
  release(): Promise<void>;
  extend(ms: number): void;
}

/** Tries the cross-process lane lock. Null when another process (or burst) holds it. */
async function tryLaneLock(deps: AppDeps, holdMs: number): Promise<HeldLock | null> {
  const reserved = await deps.sql.reserve();
  let locked = false;
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${LANE_LOCK}, 0)) as locked`;
    locked = row?.locked === true;
  } finally {
    if (!locked) reserved.release();
  }
  if (!locked) return null;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const release = async () => {
    if (released) return;
    released = true;
    if (timer) clearTimeout(timer);
    try {
      await reserved`select pg_advisory_unlock(hashtextextended(${LANE_LOCK}, 0))`;
    } catch (err) {
      // never hand a connection that may still hold the lane back to the pool holding it
      deps.logger.warn({ err }, "judge lane unlock failed; releasing every advisory lock of the connection");
      await reserved`select pg_advisory_unlock_all()`.catch(() => undefined);
    } finally {
      reserved.release();
    }
  };
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      deps.logger.warn("a live judge burst outlived its lease: the lane was freed");
      void release();
    }, ms + LANE_LOCK_GRACE_MS);
    timer.unref?.();
  };
  arm(holdMs);
  return { release, extend: arm };
}

/** The batch total a post may spend: the run's on-rail lines as they stand (the batch row supersedes it). */
async function onRailTotal(deps: AppDeps, workspaceId: string, runId: string): Promise<number> {
  const [row] = (await deps.db.execute(sql`
    select coalesce(sum(net_cents), 0)::bigint as total from member_lines
     where workspace_id = ${workspaceId} and run_id = ${runId} and rail = 'ON'`)) as unknown as {
    total: string | number;
  }[];
  return Number(row?.total ?? 0);
}

/** See the header. */
export async function beginLiveStep(deps: AppDeps, o: LiveStepInput): Promise<LiveStep> {
  const rail = deps.paypal.label;
  if (!(await isJudgeWorkspace(deps.db, o.workspaceId))) {
    return {
      kind: "live",
      decision: liveDecision(rail, NO_JUDGE_QUOTA),
      reservation: null,
      leaseUntil: deps.clock.now(),
      renew: () => true,
      end: async () => undefined,
    };
  }
  if (o.step === "post" && !o.runId) throw new TypeError("beginLiveStep: a post names its run");
  if (o.resume && o.step !== "post") throw new TypeError("beginLiveStep: only a post resumes");
  const sessionId =
    o.sessionId === undefined ? await sessionOfWorkspace(deps.db, o.workspaceId) : o.sessionId;
  // A resumed post's batch is written live: whatever would replay it makes it wait instead (never a replay).
  const wait = (d: RailDecision): LiveStep => {
    const ms = resumeWaitMs(d.reason, deps.clock.now());
    return {
      kind: "queued",
      position: null,
      etaMs: ms,
      retryAfterMs: ms,
      ...(d.reason ? { waitingFor: d.reason } : {}),
    };
  };

  // 1. a fresh peek: what replays now never waits in the queue. A post peeks with its own run left out, as the binding
  //    decision counts it (a slot an earlier attempt took is its own place; a resume's fresh slot would replace it). A
  //    resumed post also waits out kill_payouts; it is past the quotas only while its run holds a slot that still
  //    carries its POST (the binding decision below re-reads all of it under the quota lock).
  const peek = await judgeRail(deps, {
    workspaceId: o.workspaceId,
    sessionId,
    step: o.step,
    ...(o.step === "post" ? { excludeRunId: o.runId as string } : {}),
    ...(o.resume ? { resume: true } : {}),
  });
  if (peek.mode === "replay") {
    if (!o.resume) return { kind: "replay", decision: peek };
    if (!isQuotaReplay(peek) || !(await holdsLivePost(deps.db, o.runId as string, deps.clock.now()))) {
      return wait(peek);
    }
  }

  // 2. the lane: this process's queue, then every process's lock
  const lane = judgeRuntime(deps).lane;
  const entry = { workspaceId: o.workspaceId, step: o.step, sessionId };
  if (!o.resume && lane.waitedMs(entry) >= LIVE_LANE_WAIT_MS) {
    lane.release(entry);
    return { kind: "replay", decision: replayDecision("lane_full", rail, peek.quota) };
  }
  const grant = lane.acquire(entry);
  if (!grant.granted) {
    if (grant.position === null) {
      const full = replayDecision("lane_full", rail, peek.quota);
      return o.resume ? wait(full) : { kind: "replay", decision: full };
    }
    if (!o.resume && grant.etaMs > LIVE_LANE_WAIT_MS) {
      lane.release(entry);
      return { kind: "replay", decision: replayDecision("lane_full", rail, peek.quota) };
    }
    return {
      kind: "queued",
      position: grant.position,
      etaMs: grant.etaMs,
      retryAfterMs: Math.min(
        grant.etaMs,
        lane.options.reserveMs / 2,
        o.resume ? Number.POSITIVE_INFINITY : LIVE_LANE_WAIT_MS - lane.waitedMs(entry),
      ),
    };
  }
  const lock = await tryLaneLock(deps, lane.options.leaseMs);
  if (!lock) {
    // another process holds the burst: keep this process's turn and ask again shortly
    return {
      kind: "queued",
      position: null,
      etaMs: lane.options.burstMs,
      retryAfterMs: o.resume
        ? ELSEWHERE_RETRY_MS
        : Math.min(ELSEWHERE_RETRY_MS, LIVE_LANE_WAIT_MS - lane.waitedMs(entry)),
    };
  }
  const free = async () => {
    try {
      await lock.release();
    } finally {
      lane.release(entry);
    }
  };

  // 3. the binding decision, holding the lane
  let decision: RailDecision;
  let reservation: LivePostReservation | null = null;
  let answered: PostAnswered | null = null;
  try {
    if (o.step === "post") {
      const runId = o.runId as string;
      const r = await reserveLivePost(deps, {
        workspaceId: o.workspaceId,
        sessionId,
        runId,
        amountCents: o.amountCents ?? (await onRailTotal(deps, o.workspaceId, runId)),
        ...(o.resume ? { resume: true } : {}),
      });
      // binding: live only with a reservation (the run's held slot while it still carries the POST, or a fresh one
      // dated now that the quotas allowed: for a resume, the floor after its batch and C-21's 40 a day too)
      decision = r.decision;
      reservation = r.reservation;
      answered = r.answered ?? null;
    } else {
      decision = await judgeRail(deps, { workspaceId: o.workspaceId, sessionId, step: o.step });
    }
  } catch (err) {
    await free();
    throw err;
  }
  if (answered) {
    // a resume whose batch PayPal answered while it waited for the lane: nothing to send, no slot taken
    await free();
    return { kind: "done", reason: answered };
  }
  if (decision.mode === "replay") {
    await free();
    return o.resume ? wait(decision) : { kind: "replay", decision };
  }
  if (o.step === "post" && !reservation) {
    // reserveLivePost never decides live without one; should it ever, nothing is posted (the task retries)
    await free();
    throw new Error("beginLiveStep: a live judge post without a quota reservation");
  }
  let ended = false;
  return {
    kind: "live",
    decision,
    reservation,
    leaseUntil: grant.leaseUntil,
    renew() {
      if (ended || !lane.renew(entry)) return false;
      lock.extend(lane.options.leaseMs);
      return true;
    },
    async end(outcome) {
      if (ended) return;
      ended = true;
      try {
        if (reservation && outcome) {
          await settleLivePost(deps, { reservationId: reservation.id, outcome });
        }
      } finally {
        await free();
      }
    },
  };
}

/**
 * How a post's reservation settles from `PayoutsService.executeApproved`'s outcome: a created or adopted
 * batch was posted, and so was one PayPal says already exists that we could not adopt (money may have
 * moved); a synchronous 4xx was denied (it counts toward the caps, not the balance); any other refusal sent
 * nothing this time. Unresolved posts, PayPal's pacing (the circuit, and the limiter's window, which the
 * service only meets after the write), and a throw, stay open: the retry resumes the same batch under the
 * same reservation. `not_posted` frees the slot only while nothing is written: a refusal after the write
 * (a kill switch, a re-check of a resumed post) leaves it held (`settleLivePost`), since the rows still wait.
 */
export function settlementOf(outcome: BatchOutcome | null | undefined): LivePostOutcome | null {
  if (!outcome) return null;
  switch (outcome.kind) {
    case "created":
    case "adopted":
      return "posted";
    case "rejected":
      return "denied";
    case "unresolved":
      return null;
    case "refused":
      if (outcome.code === "ADOPT_FAILED") return "posted";
      if (outcome.code === "CIRCUIT_OPEN" || outcome.code === "QUEUED") return null;
      return "not_posted";
  }
}
