/**
 * Executors (architecture G2, S3.3, IC-04 "the executor `run(name, ids)`"): one interface, three ways to run a
 * claimed task. `ids` is `[outboxId]` — tasks receive ids only and load everything else from the row.
 *
 * - inline   — in this process, at most `concurrency` at a time (2 in fs-api). CI and local default; also the
 *              automatic fallback for the other two.
 * - workflow — Render Workflows: `startTask('fs-tasks/<name>', [outboxId])`. The client is injected (wrap
 *              `new Render().workflows.startTask` from @renderinc/sdk in the app), so this package never needs
 *              RENDER_API_KEY or the SDK.
 * - worker   — a Render background worker running `createWorker()` (the S6 fallback): the id is handed over
 *              with `NOTIFY fs_outbox_worker`.
 *
 * `run` returns once the hand-off is made, not when the task finishes. A remote executor must see the task reach
 * `running` within the dispatcher's start timeout (20 s), or the dispatcher runs it inline.
 */
import type { Db } from "@fairsplit/db";
import { sql } from "drizzle-orm";
import type { TaskName } from "./_shims/contracts.js";
import type { ExecutorKind } from "./runner.js";

export interface DispatchReceipt {
  /** Render's task-run id, stored in task_outbox.workflow_run_id for /ops */
  workflowRunId?: string;
}

export interface Executor {
  readonly kind: ExecutorKind;
  /** true when the task runs elsewhere and must report `running` before the start timeout */
  readonly remote: boolean;
  /** hand over the task; ids = [outboxId] */
  run(name: TaskName, ids: readonly string[]): Promise<DispatchReceipt | undefined>;
  /** free slots for executors that run tasks in this process; the dispatcher never claims more */
  capacity?(): number;
}

export interface InlineExecutor extends Executor {
  readonly kind: "inline" | "worker";
  readonly remote: false;
  capacity(): number;
  /** resolves when nothing is queued or running */
  idle(): Promise<void>;
  readonly active: number;
}

function outboxIdOf(name: TaskName, ids: readonly string[]): string {
  const id = ids[0];
  if (!id) throw new TypeError(`executor.run(${name}): ids must be [outboxId]`);
  return id;
}

/** Runs `execute(id)` in this process with bounded concurrency. `execute` is normally `runTask(deps, id, "inline")`. */
export function inlineExecutor(
  execute: (id: string) => Promise<unknown>,
  opts: { concurrency?: number; kind?: "inline" | "worker"; onError?: (e: unknown, id: string) => void } = {},
): InlineExecutor {
  const concurrency = opts.concurrency ?? 2;
  const queue: string[] = [];
  const queued = new Set<string>();
  let active = 0;
  let waiters: Array<() => void> = [];

  const settleIdle = () => {
    if (active === 0 && queue.length === 0) {
      const w = waiters;
      waiters = [];
      for (const fn of w) fn();
    }
  };

  const pump = () => {
    while (active < concurrency && queue.length > 0) {
      const id = queue.shift() as string;
      queued.delete(id);
      active++;
      execute(id)
        .catch((e) => opts.onError?.(e, id))
        .finally(() => {
          active--;
          pump();
          settleIdle();
        });
    }
  };

  return {
    kind: opts.kind ?? "inline",
    remote: false,
    async run(name, ids) {
      const id = outboxIdOf(name, ids);
      if (!queued.has(id)) {
        queued.add(id);
        queue.push(id);
      }
      pump();
      return undefined;
    },
    capacity: () => Math.max(0, concurrency - active - queue.length),
    idle: () =>
      active === 0 && queue.length === 0 ? Promise.resolve() : new Promise<void>((r) => waiters.push(r)),
    get active() {
      return active;
    },
  };
}

/** The slice of Render's SDK the workflow executor needs. */
export interface WorkflowClient {
  startTask(slug: string, args: unknown[]): Promise<unknown>;
}

export function workflowExecutor(client: WorkflowClient, opts: { service?: string } = {}): Executor {
  const service = opts.service ?? "fs-tasks";
  return {
    kind: "workflow",
    remote: true,
    async run(name, ids) {
      const res = await client.startTask(`${service}/${name}`, [outboxIdOf(name, ids)]);
      const id = pickId(res);
      return id ? { workflowRunId: id } : undefined;
    },
  };
}

function pickId(res: unknown): string | undefined {
  if (res && typeof res === "object") {
    for (const k of ["id", "taskRunId", "runId"]) {
      const v = (res as Record<string, unknown>)[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return undefined;
}

export const WORKER_CHANNEL = "fs_outbox_worker";

/** Hands the task to the background worker process (see worker.ts); payload "<outboxId>:<name>". */
export function workerExecutor(db: Db): Executor {
  return {
    kind: "worker",
    remote: true,
    async run(name, ids) {
      await db.execute(sql`select pg_notify(${WORKER_CHANNEL}, ${`${outboxIdOf(name, ids)}:${name}`})`);
      return undefined;
    },
  };
}
