// Per-task execution policy: the S3.3 executor lane each task belongs to, its Render Workflows
// timeout (30..86400 s) and its Render retry (@renderinc/sdk 1.3.0 `Retry`).
//
// Lanes (approved S3.3 and its register deviation 3: "Everything runs inline except three AI tasks
// on Workflows"). Only the Workflows lanes are registered with fs-tasks (workflow.ts); fs-tasks holds
// no PayPal credentials (S3.13), so a money task that reached it by mistake must fail at `startTask`
// ("task not found") and fall back inline, never run there.
//
// Retry model, two layers:
//  1. Within one Render run (Workflows lanes only): Render retries a thrown attempt as a new attempt
//     of the same taskRunId (RENDER_RETRY). That retry does useful work only if the failed attempt
//     did not keep the outbox row claimed: the failure happened before the claim (booting, resolving
//     the runtime, the role check, reaching the database: the row is still `dispatched`), or the
//     runner gave the row back. WS-DATA's runner does (packages/outbox runner.ts on ws/data): a
//     handler failure puts the row back to `queued` with backoff, or `dead` after its attempts.
//     Otherwise the retry's claim finds the row taken and it exits `skipped`, which is safe.
//  2. Across runs: the outbox re-queues the row (runner backoff, or the sweeper after a silent claim)
//     and the dispatcher starts a NEW run with an attempt-scoped idempotency key
//     (./handoff/idempotency.ts). Render hands back the first run for a repeated key, so a key that
//     repeated across attempts would turn every re-dispatch into a no-op. Dead after 8 attempts.
//
// Sweeper (S3.3: "re-queues rows stuck for over 5 minutes"). One threshold for every task: a row is
// stuck after 5 minutes `dispatched` without a claim, or 5 minutes `running` without a heartbeat. The
// claim heartbeats while its handler runs (WS-DATA's runner refreshes `heartbeat_at` every 30 s), so a
// healthy attempt is never swept however long it runs, and a timeout below only bounds an attempt
// that hangs: Render kills it, its heartbeat stops, and the sweeper takes the row 5 minutes later.
import type { Retry } from "@renderinc/sdk/workflows";
import { TASK_NAMES, type TaskName } from "./_shims/contracts.js";

/**
 * - `inline-api`: runs inline in fs-api's dispatcher (money, webhooks, push, the engine, the agent,
 *   and the scheduled jobs the hourly tick enqueues). One warm OAuth cache; never on Workflows.
 * - `workflow-live`: Claude reads on Workflows when live (the live read shows its Render run id);
 *   inline when the run replays recorded output (Judge Mode, register C-06).
 * - `workflow-scheduled`: enqueued by the hourly tick and run on Workflows.
 */
export type TaskLane = "inline-api" | "workflow-live" | "workflow-scheduled";

export interface TaskPolicy {
  readonly lane: TaskLane;
  /** Render kills an attempt after this long. */
  readonly timeoutSeconds: number;
  /** Render-side retries within one run (see the retry model above). */
  readonly retry: Retry;
}

/** Inline-lane tasks and the diagnostics. `waitDurationMs` is required by the SDK type but unused at 0 retries. */
export const NO_RENDER_RETRY: Retry = Object.freeze({ maxRetries: 0, waitDurationMs: 1_000 });

/**
 * Workflows lanes: two retries, 5 s then 10 s. Long enough to ride out a Claude 529 or a connection
 * reset, short enough to finish well inside the sweeper's 5-minute window, few enough to bound spend.
 */
export const RENDER_RETRY: Retry = Object.freeze({ maxRetries: 2, waitDurationMs: 5_000, backoffScaling: 2 });

/**
 * S3.3 sweeper, the same for every task: a row `dispatched` this long without a claim, or `running`
 * this long without a heartbeat, is re-queued …
 */
export const SWEEPER_STUCK_AFTER_MS = 5 * 60_000;
/** … and marked `dead` after this many attempts. */
export const SWEEPER_MAX_ATTEMPTS = 8;

const p = (lane: TaskLane, timeoutSeconds: number): TaskPolicy => ({
  lane,
  timeoutSeconds,
  retry: lane === "inline-api" ? NO_RENDER_RETRY : RENDER_RETRY,
});

/**
 * Seconds per attempt. On a Workflows lane Render kills the attempt at this point; on the inline lane
 * it is the budget fs-api's inline runner enforces (WS-DATA). Long enough for the slowest legitimate
 * run, short enough that a hung attempt frees its row soon (`hungAttemptRequeuedAfterMs`).
 */
export const TASK_POLICY: Readonly<Record<TaskName, TaskPolicy>> = Object.freeze({
  ensureInvoice: p("inline-api", 120),
  recordPayment: p("inline-api", 120),
  processWebhook: p("inline-api", 60),
  postPayoutBatch: p("inline-api", 180),
  settleBatch: p("inline-api", 120),
  cancelUnclaimed: p("inline-api", 120),
  reroute: p("inline-api", 180),
  // The live slip read (hero path). S4.9: a composite read is done within 45 s; 300 s leaves room for
  // an 8,000-token photo read (S4.1) and the gateway's retries, and a hung read is re-queued within 10 min.
  extract: p("workflow-live", 300),
  // Opus, streamed, max_tokens 16,000 for both pages in one request (S4.3); run offline.
  readRateCard: p("workflow-live", 600),
  computeRun: p("inline-api", 120),
  explain: p("inline-api", 300),
  agentTurn: p("inline-api", 600),
  pushNotify: p("inline-api", 60),
  reconcile: p("inline-api", 900),
  judgeReset: p("inline-api", 300),
  warmCaches: p("workflow-scheduled", 300),
} satisfies Record<TaskName, TaskPolicy>);

/** Task names grouped by lane, for docs and the /ops capabilities panel. */
export function tasksInLane(lane: TaskLane): TaskName[] {
  return TASK_NAMES.filter((n) => TASK_POLICY[n].lane === lane);
}

/** True for the tasks fs-tasks registers with Render Workflows. */
export function runsOnWorkflows(name: TaskName): boolean {
  return TASK_POLICY[name].lane !== "inline-api";
}

/** The tasks fs-tasks registers, in registry order (S3.3: extract, readRateCard, warmCaches). */
export const WORKFLOW_TASK_NAMES: readonly TaskName[] = Object.freeze(TASK_NAMES.filter(runsOnWorkflows));

/**
 * The longest `name`'s row waits for the sweeper after an attempt hangs: Render kills the attempt at
 * its timeout, the claim's heartbeat stops, and S3.3's sweeper re-queues the row 5 minutes later. A
 * crashed attempt frees its row sooner, 5 minutes after its last heartbeat. (WS-DATA's sweep runs
 * every minute, so add up to a minute to either.)
 */
export function hungAttemptRequeuedAfterMs(name: TaskName): number {
  return TASK_POLICY[name].timeoutSeconds * 1_000 + SWEEPER_STUCK_AFTER_MS;
}
