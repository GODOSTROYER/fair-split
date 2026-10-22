// IC-04 executor shape, `run(name, ids)`, and the inline executor used by the inline CLI (local
// development and CI, EXECUTOR=inline). The dispatcher-side executors (workflow start, inline
// fallback) are not exported from this app; see ./handoff/dispatcher.ts.
import type { ExecutorKind, TaskName } from "./_shims/contracts.js";
import type { TaskOutcome } from "./handlers.js";
import { invokeTask, type TaskRuntime } from "./invoke.js";
import type { Logger } from "./log.js";

export interface RunOptions {
  /**
   * Workflows: Render returns the first run for a key repeated within 24 h. The key must be
   * attempt-scoped (`renderIdempotencyKey(outboxIds, attempt)` in ./handoff/idempotency.ts), never
   * the bare outbox dedupe key, or a sweeper re-dispatch gets the earlier failed run back.
   */
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
  runtime: TaskRuntime;
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
        const outcome = await invokeTask(deps.runtime, name, ids, {
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
