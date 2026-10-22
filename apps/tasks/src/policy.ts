// Per-task execution policy: which executor runs it (S3.3 table, refining architecture G2) and the
// Render Workflows options it registers with (timeoutSeconds 30..86400; retry per @renderinc/sdk 1.3.0).
import type { Retry } from "@renderinc/sdk/workflows";
import { type ExecutorKind, TASK_NAMES, type TaskName } from "./_shims/contracts.js";

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
  /** Render-side retries. The outbox sweeper is the outer safety net (re-queue after 5 min, dead after 8). */
  readonly retry: Retry;
}

/** Money tasks: PayPal-Request-Id and the claim make a repeat safe, but retries stay few and slow. */
const MONEY_RETRY: Retry = { maxRetries: 2, waitDurationMs: 5_000, backoffScaling: 2 };
/** Claude calls: transient overloads clear in seconds. */
const AI_RETRY: Retry = { maxRetries: 3, waitDurationMs: 2_000, backoffScaling: 2 };
/** Scheduled housekeeping: the next hourly pass is the real retry. */
const SCHEDULED_RETRY: Retry = { maxRetries: 1, waitDurationMs: 30_000, backoffScaling: 1 };

export const TASK_POLICY: Readonly<Record<TaskName, TaskPolicy>> = Object.freeze({
  ensureInvoice: { lane: "inline-api", timeoutSeconds: 120, retry: MONEY_RETRY },
  recordPayment: { lane: "inline-api", timeoutSeconds: 120, retry: MONEY_RETRY },
  processWebhook: { lane: "inline-api", timeoutSeconds: 60, retry: MONEY_RETRY },
  postPayoutBatch: { lane: "inline-api", timeoutSeconds: 180, retry: MONEY_RETRY },
  settleBatch: { lane: "inline-api", timeoutSeconds: 120, retry: MONEY_RETRY },
  cancelUnclaimed: { lane: "inline-api", timeoutSeconds: 120, retry: MONEY_RETRY },
  reroute: { lane: "inline-api", timeoutSeconds: 180, retry: MONEY_RETRY },
  extract: { lane: "workflow-live", timeoutSeconds: 900, retry: AI_RETRY },
  readRateCard: { lane: "workflow-live", timeoutSeconds: 600, retry: AI_RETRY },
  computeRun: { lane: "workflow-live", timeoutSeconds: 120, retry: AI_RETRY },
  explain: { lane: "workflow-live", timeoutSeconds: 300, retry: AI_RETRY },
  agentTurn: { lane: "workflow-live", timeoutSeconds: 600, retry: AI_RETRY },
  pushNotify: { lane: "inline-api", timeoutSeconds: 60, retry: MONEY_RETRY },
  reconcile: { lane: "workflow-scheduled", timeoutSeconds: 900, retry: SCHEDULED_RETRY },
  judgeReset: { lane: "workflow-scheduled", timeoutSeconds: 300, retry: SCHEDULED_RETRY },
  warmCaches: { lane: "workflow-scheduled", timeoutSeconds: 300, retry: SCHEDULED_RETRY },
} satisfies Record<TaskName, TaskPolicy>);

export interface ExecutorChoiceInput {
  /** The deployment's `EXECUTOR` env value. CI and local use `inline`. */
  readonly configured: ExecutorKind;
  /** True when the run replays recorded Claude output (Judge Mode default, register C-06). */
  readonly replay: boolean;
}

/**
 * Which executor should run `name`. `inline` and `worker` deployments run everything their way;
 * a `workflow` deployment still keeps money tasks inline and runs replays inline.
 */
export function chooseExecutor(name: TaskName, input: ExecutorChoiceInput): ExecutorKind {
  if (input.configured !== "workflow") return input.configured;
  const { lane } = TASK_POLICY[name];
  if (lane === "inline-api") return "inline";
  if (lane === "workflow-live" && input.replay) return "inline";
  return "workflow";
}

export function parseExecutorKind(
  value: string | undefined,
  fallback: ExecutorKind = "inline",
): ExecutorKind {
  if (value === undefined || value === "") return fallback;
  if (value === "inline" || value === "workflow" || value === "worker") return value;
  throw new Error(`EXECUTOR must be inline, workflow or worker (got "${value}")`);
}

/** Task names grouped by lane, for docs and the /ops capabilities panel. */
export function tasksInLane(lane: TaskLane): TaskName[] {
  return TASK_NAMES.filter((n) => TASK_POLICY[n].lane === lane);
}
