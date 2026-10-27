// The judge slice's public surface for other slices (import from here, never from the files below).
//
// For the RUNS slice's money steps in a judge workspace (ensureInvoice, recordPayment, postPayoutBatch,
// cancelUnclaimed, resend):
//   const rail = await judgeRail(deps, { workspaceId, sessionId, step: "post" });   // fresh, never cached
//   if (rail.mode === "replay") → replay that step, labelled `rail.label` (provenance "replay")
//   const lane = judgeRuntime(deps).lane.acquire({ workspaceId, step: "post", sessionId });
//   if (!lane.granted) → re-queue the task (the outbox retries; the stage shows `lane.position`)
//   …PayPal calls…; judgeRuntime(deps).lane.release({ workspaceId, step: "post" });
// and, in postPayoutBatch's transaction before `executeApproved`: `await applyArmedTamper(tx, scope, runId)`.
export { LANE_DEFAULTS, type LaneGrant, type LaneView, LiveLane, laneKey } from "./lane.js";
export {
  claimPooledWorkspace,
  cloneWorkspace,
  JUDGE_WORKSPACE_TTL_MS,
  POOL_TARGET,
  poolName,
  poolSize,
  purgeExpiredJudgeWorkspaces,
  refillPool,
  retireStalePool,
} from "./pool.js";
export {
  dailyLivePostCap,
  decideRail,
  estimateBalance,
  isJudgeWorkspace,
  JUDGE_QUOTA,
  type JudgeStep,
  judgeRail,
  type QuotaFacts,
  quotaFacts,
  type RailDecision,
  REPLAY_COPY,
  type ReplayReason,
} from "./quota.js";
export { MAX_CANCELS_PER_PASS, PARKED_AFTER_MS, runJudgeReset } from "./reset-task.js";
export { JUDGE_RATE_RULES, type JudgeRuntime, judgeRuntime, PRESENCE } from "./runtime.js";
export { latestRun, workspaceAlive, workspaceRow } from "./session.js";
export {
  applyArmedTamper,
  armChangePayout,
  DRAFT_TAMPERS,
  TAMPER_KINDS,
  TAMPER_LABEL,
  type TamperKind,
  tamperArmed,
  tamperDraft,
  tamperedDraft,
} from "./tamper.js";
export {
  brandPersona,
  type JudgeWorld,
  materializeWorld,
  openingLedger,
  seedTag,
  worldPersonas,
} from "./world.js";
