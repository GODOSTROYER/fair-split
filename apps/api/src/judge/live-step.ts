// The one protocol for a live judge PayPal step (S3.9, plan "Limits"). The run slice's money tasks
// (ensureInvoice, recordPayment, postPayoutBatch, cancelUnclaimed, resend) call it before any PayPal call:
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
//      a fresh peek. A replay releases the lane at once.
// Outside judge workspaces (showcase, real) nothing here applies: the step is live, with no lane and no
// quota, and the run slice's own guards (kill switch, limiter, circuit) stand.
import type { BatchOutcome } from "@fairsplit/paypal-payouts";
import { sql } from "drizzle-orm";
import { sessionOfWorkspace } from "../credentials/issue/tokens.js";
import type { AppDeps } from "../lib/context.js";
import {
  isJudgeWorkspace,
  type JudgeStep,
  judgeRail,
  type LivePostOutcome,
  type LivePostReservation,
  liveDecision,
  type QuotaNumbers,
  type RailDecision,
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

export interface LiveStepInput {
  workspaceId: string;
  /** The judge session that owns the workspace (read from its tokens when omitted). */
  sessionId?: string | null;
  step: JudgeStep;
  /** The post only: the run it posts. */
  runId?: string;
  /** The post only: the batch total it may spend (the run's on-rail lines when omitted). */
  amountCents?: number;
}

export type LiveStep =
  | {
      kind: "queued";
      /** Bursts ahead of this one (null when another process holds the lane and positions are unknown). */
      position: number | null;
      etaMs: number;
      retryAfterMs: number;
    }
  | { kind: "replay"; decision: RailDecision }
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
  const sessionId =
    o.sessionId === undefined ? await sessionOfWorkspace(deps.db, o.workspaceId) : o.sessionId;

  // 1. a fresh peek: what replays now never waits in the queue
  const peek = await judgeRail(deps, { workspaceId: o.workspaceId, sessionId, step: o.step });
  if (peek.mode === "replay") return { kind: "replay", decision: peek };

  // 2. the lane: this process's queue, then every process's lock
  const lane = judgeRuntime(deps).lane;
  const entry = { workspaceId: o.workspaceId, step: o.step, sessionId };
  const grant = lane.acquire(entry);
  if (!grant.granted) {
    if (grant.position === null) {
      return { kind: "replay", decision: replayDecision("lane_full", rail, peek.quota) };
    }
    return { kind: "queued", position: grant.position, etaMs: grant.etaMs, retryAfterMs: grant.etaMs };
  }
  const lock = await tryLaneLock(deps, lane.options.leaseMs);
  if (!lock) {
    // another process holds the burst: keep this process's turn and ask again shortly
    return {
      kind: "queued",
      position: null,
      etaMs: lane.options.burstMs,
      retryAfterMs: ELSEWHERE_RETRY_MS,
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
  try {
    if (o.step === "post") {
      const runId = o.runId as string;
      const r = await reserveLivePost(deps, {
        workspaceId: o.workspaceId,
        sessionId,
        runId,
        amountCents: o.amountCents ?? (await onRailTotal(deps, o.workspaceId, runId)),
      });
      decision = r.decision;
      reservation = r.reservation;
    } else {
      decision = await judgeRail(deps, { workspaceId: o.workspaceId, sessionId, step: o.step });
    }
  } catch (err) {
    await free();
    throw err;
  }
  if (decision.mode === "replay") {
    await free();
    return { kind: "replay", decision };
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
 * moved); a synchronous 4xx was denied (it counts toward the caps, not the balance); a refusal sent
 * nothing (the slot is free again). Unresolved or circuit-open posts, and a throw, stay open: the retry
 * resumes the same batch under the same reservation.
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
      if (outcome.code === "CIRCUIT_OPEN") return null;
      return "not_posted";
  }
}
