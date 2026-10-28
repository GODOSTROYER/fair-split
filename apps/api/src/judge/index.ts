// The judge slice's public surface for other slices (import from here, never from the files below).
//
// For the RUNS slice's money steps in a judge workspace (the invoice turn, ensureInvoice, recordPayment,
// postPayoutBatch, cancelUnclaimed, reroute), one protocol, before any PayPal call (live-step.ts has the details;
// money/rail.ts applies it, and runs a replayed step on the replay rail):
//
//   const step = await beginLiveStep(deps, { workspaceId, step: "post", runId });   // fresh, never cached
//   if (step.kind === "queued") → re-queue the task (retry after step.retryAfterMs; the stage shows position)
//   if (step.kind === "replay") → replay that step, labelled step.decision.label (provenance "replay")
//   let outcome;
//   try {
//     outcome = await withArmedTamper(deps, { scope, runId }, () => service.executeApproved(runId));
//   } finally {
//     await step.end(settlementOf(outcome));   // steps other than the post: step.end()
//   }
//
// The live lane is single-flight across every process that shares the database (a Postgres advisory lock),
// and the post is decided and reserved under one lock while the lane is held, so the daily, hourly and
// per-cookie caps hold under concurrency. Everything that decides money (reservations, spend, balance
// readings, judge codes, tamper arming) is durable in Postgres. Per-process and advisory only: queue
// positions and ETAs, presence, and the request throttles (session starts, frames, pairing): a restart
// resets those, never a quota. So the single flight and the caps hold for every process that calls this
// protocol on the same database (a second fs-api instance included). The protocol takes fs-api's AppDeps:
// a judge money task that runs elsewhere (EXECUTOR=workflow) must build them, or stay inline in fs-api
// like `judgeReset` (WS-OPS handoff).
export { LANE_DEFAULTS, type LaneGrant, type LaneView, LiveLane, laneKey } from "./lane.js";
export {
  beginLiveStep,
  ELSEWHERE_RETRY_MS,
  LANE_LOCK,
  type LiveStep,
  type LiveStepInput,
  NO_JUDGE_QUOTA,
  RESUME_QUOTA_WAIT_MS,
  resumeWaitMs,
  settlementOf,
} from "./live-step.js";
export {
  claimCloned,
  claimPooledWorkspace,
  cloneWorkspace,
  JUDGE_WORKSPACE_TTL_MS,
  POOL_TARGET,
  poolName,
  poolSize,
  purgeExpiredJudgeWorkspaces,
  refillPool,
  retireStalePool,
  workspaceInUse,
} from "./pool.js";
export {
  type BalanceEstimate,
  type BalanceReading,
  dailyLivePostCap,
  decideRail,
  estimateBalance,
  isCodedSession,
  isJudgeWorkspace,
  JUDGE_QUOTA,
  type JudgeStep,
  judgeRail,
  type LivePostOutcome,
  type LivePostReservation,
  type QuotaFacts,
  quotaFacts,
  type RailDecision,
  REPLAY_COPY,
  REPLAY_REASONS,
  type ReplayReason,
  recordBalanceReading,
  replayDecision,
  reserveLivePost,
  settleLivePost,
} from "./quota.js";
export { MAX_CANCELS_PER_PASS, PARKED_AFTER_MS, runJudgeReset } from "./reset-task.js";
export { JUDGE_RATE_RULES, type JudgeRuntime, judgeRuntime, PRESENCE } from "./runtime.js";
export { latestRun, workspaceAlive, workspaceRow } from "./session.js";
export {
  applyArmedTamper,
  armChangePayout,
  DRAFT_TAMPERS,
  revertAppliedTamper,
  TAMPER_KINDS,
  TAMPER_LABEL,
  type TamperKind,
  tamperArmed,
  tamperDraft,
  tamperedDraft,
  withArmedTamper,
} from "./tamper.js";
export {
  brandPersona,
  type JudgeWorld,
  materializeWorld,
  openingLedger,
  seedTag,
  worldPersonas,
} from "./world.js";
