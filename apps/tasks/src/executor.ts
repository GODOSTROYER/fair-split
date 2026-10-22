// IC-04 executors: `run(name, ids)` on inline, workflow (Render Workflows) or worker.
// The inline executor is what CI and local development use (EXECUTOR=inline); fs-api also uses it
// for money tasks and as the fallback when Workflows is slow or down (S3.3 step 4).
import type { WorkflowsClient } from "@renderinc/sdk/workflows";
import type { ExecutorKind, TaskName } from "./_shims/contracts.js";
import type { TaskHandlers, TaskOutcome } from "./handlers.js";
import { invokeTask, validateIds } from "./invoke.js";
import type { Logger } from "./log.js";
import { taskSlug, WORKFLOW_SERVICE } from "./workflow.js";

export interface RunOptions {
  /** Workflows: Render dedupes starts with the same key for 24 h. Pass the outbox dedupe key. */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface ExecutorReceipt {
  readonly executor: ExecutorKind;
  /** Inline runs return the handler's outcome. */
  readonly outcome?: TaskOutcome;
  /** Workflow runs return Render's run id; the outcome arrives through the outbox row. */
  readonly taskRunId?: string;
}

export interface TaskExecutor {
  readonly kind: ExecutorKind;
  run(name: TaskName, ids: readonly string[], options?: RunOptions): Promise<ExecutorReceipt>;
}

/** A counting semaphore; waiters are released in FIFO order. */
export class Semaphore {
  #active = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("semaphore limit must be a positive integer");
  }

  get active(): number {
    return this.#active;
  }

  get waiting(): number {
    return this.#waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.#active < this.limit) {
      this.#active++;
    } else {
      // The releaser hands its slot straight to the next waiter, so `#active` is unchanged here.
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiters.shift();
      if (next) next();
      else this.#active--;
    };
  }
}

/** S3.3: the inline executor runs at most two tasks at a time. */
export const INLINE_CONCURRENCY = 2;

export interface InlineExecutor extends TaskExecutor {
  readonly kind: "inline";
  readonly active: number;
  readonly waiting: number;
}

export function createInlineExecutor(deps: {
  handlers: TaskHandlers;
  logger: Logger;
  concurrency?: number;
}): InlineExecutor {
  const gate = new Semaphore(deps.concurrency ?? INLINE_CONCURRENCY);
  return {
    kind: "inline",
    get active() {
      return gate.active;
    },
    get waiting() {
      return gate.waiting;
    },
    async run(name, ids, options) {
      const release = await gate.acquire();
      try {
        const outcome = await invokeTask(deps.handlers, name, ids, {
          executor: "inline",
          signal: options?.signal,
          logger: deps.logger,
        });
        return { executor: "inline", outcome };
      } finally {
        release();
      }
    },
  };
}

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
