// HANDOFF to WS-DATA (packages/outbox). NOT EXPORTED from @fairsplit/tasks.
//
// IC-04 gives "outbox with the inline executor" and `run(name, ids)` to WS-DATA, and the dependency
// rule makes apps/api and apps/tasks siblings, so fs-api's dispatcher must not import this app.
// This file is WS-OPS's reference implementation of the dispatcher side of S3.3 (start on Workflows,
// inline fallback after 20 s, executor choice per lane), kept here with its tests so WS-DATA can
// lift it into packages/outbox as a file move. Delete it from apps/tasks once that lands.
import type { WorkflowsClient } from "@renderinc/sdk/workflows";
import type { ExecutorKind, TaskName } from "../_shims/contracts.js";
import type { ExecutorReceipt, TaskExecutor } from "../executor.js";
import { validateIds } from "../invoke.js";
import type { ActiveFlags } from "../kill.js";
import type { Logger } from "../log.js";
import { runsOnWorkflows, TASK_POLICY } from "../policy.js";
import { taskSlug, WORKFLOW_SERVICE } from "../workflow.js";
import { renderIdempotencyKey } from "./idempotency.js";

/**
 * The slice of the SDK's WorkflowsClient the dispatcher uses (`new Render().workflows`). There is
 * deliberately no `cancelTaskRun`: a run that was slow to report `running` may already hold the
 * claim and be part-way through its effects, so the dispatcher never cancels one.
 */
export type WorkflowsPort = Pick<WorkflowsClient, "startTask" | "getTaskRun">;

export class NotOnWorkflowsError extends Error {
  override readonly name = "NotOnWorkflowsError";
  constructor(readonly task: TaskName) {
    super(`Task ${task} runs inline in fs-api (S3.3); fs-tasks does not register it`);
  }
}

export function createWorkflowExecutor(deps: {
  client: WorkflowsPort;
  /** The workflow's slug (render.yaml `fromService … property: slug`); defaults to `fs-tasks`. */
  workflowSlug?: string;
}): TaskExecutor {
  const slug = deps.workflowSlug ?? WORKFLOW_SERVICE;
  return {
    kind: "workflow",
    async run(name, ids, options) {
      const input = validateIds(ids);
      // Refuse before calling Render: fs-tasks registers only the Workflows lanes (and holds no
      // PayPal credentials), so this would only come back as "task not found".
      if (!runsOnWorkflows(name)) throw new NotOnWorkflowsError(name);
      const startOptions = {
        ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      };
      const result = await deps.client.startTask(taskSlug(name, slug), input, startOptions);
      return { executor: "workflow", taskRunId: result.taskRunId };
    },
  };
}

/** Statuses that prove the run we started was picked up (`TaskRunStatus`, @renderinc/sdk 1.3.0). */
const PICKED_UP: ReadonlySet<string> = new Set(["running", "succeeded", "completed"]);
/**
 * Terminal statuses seen before the run was ever seen running. With attempt-scoped keys this means
 * Render handed back an earlier run for a reused key, or someone cancelled the run before it
 * started; either way nothing will execute this attempt on Workflows, so it runs inline now.
 */
const TERMINAL: ReadonlySet<string> = new Set(["failed", "canceled"]);

export interface FallbackOptions {
  /** S3.3: run inline if Workflows has not reported `running` within 20 s. */
  readonly pickupDeadlineMs?: number;
  readonly pollEveryMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /**
   * The row's dispatch attempt (a counter that changes on every dispatch). It scopes Render's
   * idempotency key to this attempt (`renderIdempotencyKey`), so a sweeper re-dispatch starts a new
   * run instead of getting the earlier failed one back. Omit to start without a key.
   */
  readonly attempt?: number;
}

export interface FallbackReceipt extends ExecutorReceipt {
  /** Why the inline path ran, when it did. */
  readonly fellBack?: "start-failed" | "not-picked-up" | "terminal-before-pickup";
  /** Milliseconds from startTask to the first picked-up status (the S6 metric). */
  readonly pickupMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Start on Workflows; fall back to inline when `startTask` throws, the run is not picked up in
 * time, or Render reports it finished without ever running. The Workflows run is never cancelled:
 * it may have claimed the row between the last poll and the deadline and be mid-effect, and the
 * claim already makes the duplicate harmless (whichever runner loses the claim gets `skipped`).
 * Status reads go to Render's API, never to PayPal.
 */
export async function runWithFallback(
  deps: { workflow: WorkflowsPort; inline: TaskExecutor; workflowSlug?: string; logger: Logger },
  name: TaskName,
  rawIds: readonly string[],
  options: FallbackOptions = {},
): Promise<FallbackReceipt> {
  const ids = validateIds(rawIds);
  const deadline = options.pickupDeadlineMs ?? 20_000;
  const every = options.pollEveryMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const runOpts =
    options.attempt === undefined ? {} : { idempotencyKey: renderIdempotencyKey(ids, options.attempt) };
  const wf = createWorkflowExecutor(
    deps.workflowSlug
      ? { client: deps.workflow, workflowSlug: deps.workflowSlug }
      : { client: deps.workflow },
  );

  const started = now();
  let taskRunId: string | undefined;
  try {
    taskRunId = (await wf.run(name, ids, runOpts)).taskRunId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn({ task: name, err: message }, "startTask failed; running inline");
  }
  if (!taskRunId) return { ...(await deps.inline.run(name, ids)), fellBack: "start-failed" };

  let fellBack: FallbackReceipt["fellBack"] = "not-picked-up";
  for (;;) {
    try {
      const status = String((await deps.workflow.getTaskRun(taskRunId)).status);
      if (PICKED_UP.has(status)) return { executor: "workflow", taskRunId, pickupMs: now() - started };
      if (TERMINAL.has(status)) {
        fellBack = "terminal-before-pickup";
        break;
      }
    } catch {
      // A failed status read proves nothing; keep waiting until the deadline.
    }
    if (now() - started >= deadline) break;
    await sleep(every);
  }
  deps.logger.warn(
    { task: name, taskRunId, deadline, fellBack },
    "workflow run not picked up; running inline",
  );
  return { ...(await deps.inline.run(name, ids)), fellBack, taskRunId };
}

export interface ExecutorChoiceInput {
  /** The deployment's `EXECUTOR` env value. CI and local use `inline`. */
  readonly configured: ExecutorKind;
  /** True when the run replays recorded Claude output (Judge Mode default, register C-06). */
  readonly replay: boolean;
  /**
   * The kill flags the dispatcher read fresh for this row (S3.11). Under `kill_ai_live` ("replay
   * only") the AI lanes stay in fs-api, where this flag set was read, so a lagging FS_KILL on
   * fs-tasks (render.yaml sets it per service) can never run a live Claude call there.
   */
  readonly flags?: ActiveFlags;
}

/**
 * Which executor should run `name`. `inline` and `worker` deployments run everything their way;
 * a `workflow` deployment sends only the Workflows lanes to fs-tasks, and keeps replays and
 * anything under `kill_ai_live` inline.
 */
export function chooseExecutor(name: TaskName, input: ExecutorChoiceInput): ExecutorKind {
  if (input.configured !== "workflow") return input.configured;
  const { lane } = TASK_POLICY[name];
  if (lane === "inline-api") return "inline";
  if (lane === "workflow-live" && input.replay) return "inline";
  if (input.flags?.has("ai_live")) return "inline";
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
