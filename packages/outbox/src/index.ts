// @fairsplit/outbox: the transactional outbox (architecture G2, IC-04): enqueue(tx, name, args, dedupeKey),
// a SKIP LOCKED dispatcher, and the inline | workflow | worker executors behind one interface.
import type { Db } from "@fairsplit/db";
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "./dispatcher.js";
import {
  type Executor,
  type InlineExecutor,
  inlineExecutor,
  type WorkflowClient,
  workerExecutor,
  workflowExecutor,
} from "./executors.js";
import { type ExecutorKind, type RunnerDeps, type RunOutcome, runTask, type TaskHandlers } from "./runner.js";

export { TASK_NAMES, type TaskName } from "./_shims/contracts.js";
export * from "./dispatcher.js";
export * from "./enqueue.js";
export * from "./executors.js";
export * from "./routing.js";
export * from "./runner.js";
export * from "./worker.js";

/** EXECUTOR=inline (CI, local) | workflow (Render Workflows) | worker (S6 fallback). Default inline. */
export function executorKindFromEnv(env: Record<string, string | undefined> = process.env): ExecutorKind {
  const v = (env.EXECUTOR ?? "inline").trim().toLowerCase();
  if (v === "inline" || v === "workflow" || v === "worker") return v;
  throw new Error(`EXECUTOR must be inline, workflow or worker (got "${v}")`);
}

export interface OutboxOptions extends Omit<RunnerDeps, "db"> {
  db: Db;
  /** connection string for LISTEN fs_outbox wake-ups */
  listenUrl?: string;
  /** EXECUTOR: where the tasks the route sends away run (default inline: everything in this process) */
  executor?: ExecutorKind;
  /** per-task routing (default: S3.3's table, `defaultRoute`); a route to an executor not configured runs inline */
  route?: DispatcherOptions["route"];
  /** true for a task that will replay recorded output (Judge Mode, kill_ai_live): it stays inline */
  replay?: DispatcherOptions["replay"];
  /** required when executor is "workflow" */
  workflowClient?: WorkflowClient;
  /** inline concurrency (default 2) */
  concurrency?: number;
  dispatcher?: Partial<
    Pick<
      DispatcherOptions,
      "batchSize" | "pollMs" | "startTimeoutMs" | "stuckAfterMs" | "sweepEveryMs" | "onEvent"
    >
  >;
}

export interface Outbox {
  dispatcher: Dispatcher;
  /** the in-process executor: every task the route keeps here, and the fallback for remote hand-offs */
  inline: InlineExecutor;
  /** the executor EXECUTOR names (the in-process one when inline) */
  primary: Executor;
  /** run one task by id here (what a Render Workflows task body calls with executor "workflow") */
  runTask(outboxId: string, executor?: ExecutorKind): Promise<RunOutcome>;
}

/**
 * Wires runner, executors and dispatcher the way fs-api runs them. Each claimed task is routed on its own (S3.3):
 * money, webhook, engine and agent tasks run inline here even with EXECUTOR=workflow; only the live AI reads and
 * cache warming go to Render Workflows (or the worker).
 */
export function createOutbox(o: OutboxOptions): Outbox {
  const runner: RunnerDeps = {
    db: o.db,
    handlers: o.handlers as TaskHandlers,
    workerId: o.workerId,
    ...(o.heartbeatMs !== undefined ? { heartbeatMs: o.heartbeatMs } : {}),
    ...(o.backoffMs ? { backoffMs: o.backoffMs } : {}),
    ...(o.onEvent ? { onEvent: o.onEvent } : {}),
  };
  const inline = inlineExecutor((id) => runTask(runner, id, "inline"), { concurrency: o.concurrency ?? 2 });
  const kind = o.executor ?? "inline";
  let primary: Executor = inline;
  if (kind === "workflow") {
    if (!o.workflowClient) throw new Error("executor=workflow needs a workflowClient (Render startTask)");
    primary = workflowExecutor(o.workflowClient);
  } else if (kind === "worker") {
    primary = workerExecutor(o.db);
  }
  const dispatcher = createDispatcher({
    db: o.db,
    executor: primary,
    workerId: o.workerId,
    ...(primary.remote ? { fallback: inline } : {}),
    ...(o.route ? { route: o.route } : {}),
    ...(o.replay ? { replay: o.replay } : {}),
    ...(o.listenUrl ? { listenUrl: o.listenUrl } : {}),
    ...(o.dispatcher ?? {}),
  });
  return {
    dispatcher,
    inline,
    primary,
    runTask: (outboxId, executor = "inline") => runTask(runner, outboxId, executor),
  };
}
