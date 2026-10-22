// The handler port. Implementations live in other workstreams (outbox, paypal-*, ai); this package
// only wires them to an executor. A handler receives ids only, loads its state by id, claims its
// `task_outbox` row optimistically and is a no-op when run twice (architecture §2 step 4, S3.3).
import type { ExecutorKind, TaskName } from "./_shims/contracts.js";

/** What every executor passes to a handler. */
export interface TaskInvocation {
  readonly name: TaskName;
  /** `task_outbox` ids (IC-04 `run(name, ids)`); never payloads. */
  readonly ids: readonly string[];
  readonly executor: ExecutorKind;
  /** Render Workflows run id, when the workflow executor ran it. */
  readonly taskRunId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * JSON-serialisable result. `skipped` means the claim found the row already taken or finished,
 * which is the normal outcome of a duplicate dispatch.
 */
export interface TaskOutcome {
  readonly status: "done" | "skipped" | "failed";
  readonly detail?: string;
  /** Machine code for a permanent failure, for example `NOT_WIRED` or `KILL_SWITCH`. */
  readonly code?: string;
}

export type TaskHandler = (invocation: TaskInvocation) => Promise<TaskOutcome>;

export type TaskHandlers = Readonly<Record<TaskName, TaskHandler>>;

/**
 * A failure that retrying cannot fix (bad input, a refused policy, a dead row). The wrapper turns it
 * into a `failed` outcome instead of throwing, so Render does not spend retries on it.
 */
export class PermanentTaskError extends Error {
  override readonly name = "PermanentTaskError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown by the placeholder handlers until the owning workstream's implementation is wired in. */
export class TaskNotWiredError extends PermanentTaskError {
  constructor(readonly task: TaskName) {
    super("NOT_WIRED", `Task ${task} has no handler wired yet`);
  }
}

/** Every TaskName mapped to a handler that refuses with NOT_WIRED. */
export function unwiredHandlers(names: readonly TaskName[]): TaskHandlers {
  const entries = names.map((name) => [
    name,
    async (): Promise<TaskOutcome> => {
      throw new TaskNotWiredError(name);
    },
  ]);
  return Object.freeze(Object.fromEntries(entries)) as TaskHandlers;
}

/** Overlay real handlers on the placeholders; unknown keys are a type error. */
export function withHandlers(
  base: TaskHandlers,
  overrides: Partial<Record<TaskName, TaskHandler>>,
): TaskHandlers {
  return Object.freeze({ ...base, ...overrides });
}
