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
import type { Logger } from "../log.js";
import { TASK_POLICY } from "../policy.js";
import { taskSlug, WORKFLOW_SERVICE } from "../workflow.js";

/** The slice of the SDK's WorkflowsClient the executors use (`new Render().workflows`). */
export type WorkflowsPort = Pick<WorkflowsClient, "startTask" | "getTaskRun" | "cancelTaskRun">;

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
      const startOptions = {
        ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      };
      const result = await deps.client.startTask(taskSlug(name, slug), input, startOptions);
      return { executor: "workflow", taskRunId: result.taskRunId };
    },
  };
}

/** Statuses that prove a Workflows run was picked up. */
const PICKED_UP: ReadonlySet<string> = new Set(["running", "succeeded", "completed", "failed", "canceled"]);

export interface FallbackOptions {
  /** S3.3: run inline if Workflows has not reported `running` within 20 s. */
  readonly pickupDeadlineMs?: number;
  readonly pollEveryMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly idempotencyKey?: string;
}

export interface FallbackReceipt extends ExecutorReceipt {
  /** Why the inline path ran, when it did. */
  readonly fellBack?: "start-failed" | "not-picked-up";
  /** Milliseconds from startTask to the first picked-up status (the S6 metric). */
  readonly pickupMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Start on Workflows; fall back to inline when `startTask` throws or the run is not picked up in time.
 * A late duplicate is harmless: handlers claim their outbox row, so the second runner gets `skipped`.
 * Status reads go to Render's API, never to PayPal.
 */
export async function runWithFallback(
  deps: { workflow: WorkflowsPort; inline: TaskExecutor; workflowSlug?: string; logger: Logger },
  name: TaskName,
  ids: readonly string[],
  options: FallbackOptions = {},
): Promise<FallbackReceipt> {
  const deadline = options.pickupDeadlineMs ?? 20_000;
  const every = options.pollEveryMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const runOpts = options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {};
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
  if (!taskRunId) return { ...(await deps.inline.run(name, ids, runOpts)), fellBack: "start-failed" };

  for (;;) {
    try {
      const run = await deps.workflow.getTaskRun(taskRunId);
      if (PICKED_UP.has(String(run.status))) {
        return { executor: "workflow", taskRunId, pickupMs: now() - started };
      }
    } catch {
      // A failed status read proves nothing; keep waiting until the deadline.
    }
    if (now() - started >= deadline) break;
    await sleep(every);
  }
  deps.logger.warn({ task: name, taskRunId, deadline }, "workflow run not picked up; running inline");
  await deps.workflow.cancelTaskRun(taskRunId).catch(() => undefined);
  return { ...(await deps.inline.run(name, ids, runOpts)), fellBack: "not-picked-up", taskRunId };
}

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
