// Per-task registration policy for Render Workflows (timeoutSeconds 30..86400; retry per
// @renderinc/sdk 1.3.0), plus the S3.3 executor lane each task belongs to, for docs and /ops.
//
// Retry model (one owner): the outbox sweeper. S3.3's claim
// (`UPDATE … SET state='running' … WHERE state IN ('queued','dispatched')`) moves the row before the
// handler does any I/O, so a Render retry after a transient throw would find no row and return
// `skipped`. Render-side retries could therefore never do useful work; every task registers with
// `maxRetries: 0` and the sweeper re-queues a row stuck in `running` after 5 minutes, marking it
// `dead` after 8 attempts. If WS-DATA later makes the claim re-entrant for the same run
// (`OR (state='running' AND claimed_by=$taskRunId)`), Render retries can be turned back on here.
import type { Retry } from "@renderinc/sdk/workflows";
import { TASK_NAMES, type TaskName } from "./_shims/contracts.js";

/**
 * - `inline-api`: money, webhook and push tasks run inline in fs-api (warm OAuth cache, sub-second).
 * - `workflow-live`: AI and engine tasks run on Workflows when live, inline when replaying.
 * - `workflow-scheduled`: started by fs-cron through the outbox, run on Workflows.
 */
export type TaskLane = "inline-api" | "workflow-live" | "workflow-scheduled";

export interface TaskPolicy {
  readonly lane: TaskLane;
  /** Render kills a run after this long. */
  readonly timeoutSeconds: number;
  /** Render-side retries: always none (see the retry model above). */
  readonly retry: Retry;
}

/** The outbox sweeper owns retries. `waitDurationMs` is required by the SDK type but unused at 0 retries. */
export const NO_RENDER_RETRY: Retry = Object.freeze({ maxRetries: 0, waitDurationMs: 1_000 });

/** S3.3 sweeper: a row stuck in `running` this long is re-queued … */
export const SWEEPER_STUCK_AFTER_MS = 5 * 60_000;
/** … and marked `dead` after this many attempts. */
export const SWEEPER_MAX_ATTEMPTS = 8;

const p = (lane: TaskLane, timeoutSeconds: number): TaskPolicy => ({
  lane,
  timeoutSeconds,
  retry: NO_RENDER_RETRY,
});

export const TASK_POLICY: Readonly<Record<TaskName, TaskPolicy>> = Object.freeze({
  ensureInvoice: p("inline-api", 120),
  recordPayment: p("inline-api", 120),
  processWebhook: p("inline-api", 60),
  postPayoutBatch: p("inline-api", 180),
  settleBatch: p("inline-api", 120),
  cancelUnclaimed: p("inline-api", 120),
  reroute: p("inline-api", 180),
  extract: p("workflow-live", 900),
  readRateCard: p("workflow-live", 600),
  computeRun: p("workflow-live", 120),
  explain: p("workflow-live", 300),
  agentTurn: p("workflow-live", 600),
  pushNotify: p("inline-api", 60),
  reconcile: p("workflow-scheduled", 900),
  judgeReset: p("workflow-scheduled", 300),
  warmCaches: p("workflow-scheduled", 300),
} satisfies Record<TaskName, TaskPolicy>);

/** Task names grouped by lane, for docs and the /ops capabilities panel. */
export function tasksInLane(lane: TaskLane): TaskName[] {
  return TASK_NAMES.filter((n) => TASK_POLICY[n].lane === lane);
}
