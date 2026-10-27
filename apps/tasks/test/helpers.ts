import { Writable } from "node:stream";
import type { RegisterTaskOptions, TaskContext, TaskFunction } from "@renderinc/sdk/workflows";
import { TASK_NAMES, type TaskName } from "../src/_shims/contracts.js";
import { type TaskHandler, unwiredHandlers, withHandlers } from "../src/handlers.js";
import type { OutboxPort, TaskRuntime } from "../src/invoke.js";
import { type FlagSource, NO_FLAGS } from "../src/kill.js";
import { createLogger, type Logger } from "../src/log.js";
import type { RegisterFn } from "../src/workflow.js";

/** A logger that captures parsed JSON lines, for asserting on log output. */
export function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString("utf8").split("\n"))
        if (l.trim()) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { logger: createLogger({}, { level: "debug", destination }), lines };
}

export const OUTBOX_ID = "0192f0a8-6c1e-7a3b-9d2e-4f5a6b7c8d9e";

/** A TaskRuntime over the NOT_WIRED placeholders, with a recording outbox and no kill flags. */
export function testRuntime(
  overrides: Partial<Record<TaskName, TaskHandler>> = {},
  opts: { readFlags?: FlagSource; markFailed?: OutboxPort["markFailed"] } = {},
): TaskRuntime & { failed: { id: string; code: string; detail: string }[] } {
  const failed: { id: string; code: string; detail: string }[] = [];
  return {
    failed,
    handlers: withHandlers(unwiredHandlers(TASK_NAMES), overrides),
    outbox: {
      markFailed:
        opts.markFailed ??
        (async (id, code, detail) => {
          failed.push({ id, code, detail });
        }),
    },
    readFlags: opts.readFlags ?? (() => NO_FLAGS),
  };
}

export interface Recorded {
  options: RegisterTaskOptions;
  func: TaskFunction<unknown[], unknown>;
}

/** A stand-in for the SDK's `task()` that records what fs-tasks registers. */
export function recorder(): { register: RegisterFn; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const register = ((options: RegisterTaskOptions, func: TaskFunction<unknown[], unknown>) => {
    calls.push({ options, func });
    return { name: options.name, func };
  }) as unknown as RegisterFn;
  return { register, calls };
}

/** The context Render hands a task function. */
export const taskContext = (taskRunId = "trn-test-1"): TaskContext => ({
  metadata: { taskRunId },
  run: async () => {
    throw new Error("subtasks are not used by fs-tasks");
  },
});

export type OutboxState = "queued" | "dispatched" | "running" | "done" | "dead";

/**
 * In-memory model of one `task_outbox` row, the test oracle for the retry model: S3.3's claim
 * (optionally re-entrant for the same claimant), a runner that releases the row on failure, and the
 * sweeper. `dispatches` is the per-dispatch attempt counter that scopes Render's idempotency key.
 */
export class OutboxRow {
  state: OutboxState = "queued";
  claimedBy: string | undefined;
  dispatches = 0;

  constructor(readonly opts: { reentrant?: boolean; maxAttempts?: number } = {}) {}

  /** The dispatcher takes a queued row; returns this dispatch's attempt number. */
  dispatch(): number {
    if (this.state !== "queued") throw new Error(`cannot dispatch a ${this.state} row`);
    this.state = "dispatched";
    this.claimedBy = undefined;
    return ++this.dispatches;
  }

  /** `UPDATE … SET state='running', claimed_by=$me WHERE state IN ('queued','dispatched') [OR mine]`. */
  claim(claimant: string): boolean {
    const free = this.state === "queued" || this.state === "dispatched";
    const mine = this.opts.reentrant === true && this.state === "running" && this.claimedBy === claimant;
    if (!free && !mine) return false;
    this.state = "running";
    this.claimedBy = claimant;
    return true;
  }

  finish(claimant: string): void {
    if (this.state === "running" && this.claimedBy === claimant) this.state = "done";
  }

  /** A runner that gives the row back on failure (WS-DATA's runner re-queues it with backoff). */
  release(claimant: string): void {
    if (this.state === "running" && this.claimedBy === claimant) {
      this.state = "queued";
      this.claimedBy = undefined;
    }
  }

  /** The sweeper: a row stuck in `dispatched` or `running` is re-queued, or dead after max attempts. */
  sweep(): void {
    if (this.state !== "running" && this.state !== "dispatched") return;
    this.state = this.dispatches >= (this.opts.maxAttempts ?? 8) ? "dead" : "queued";
    this.claimedBy = undefined;
  }
}
