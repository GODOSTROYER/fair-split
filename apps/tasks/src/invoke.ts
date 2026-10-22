// The one wrapper every executor goes through: validate ids, read the kill flags fresh, refuse what
// they refuse at entry, call the injected handler with the flag set, time it, log it, and classify
// failures. A permanent failure is written to `task_outbox` through the OutboxPort and returned as a
// `failed` outcome; a transient one is rethrown, so Render retries it within the same run (Workflows
// lanes, policy.ts) and, once those are spent, the outbox re-queues the row as a new attempt.
import type { ExecutorKind, TaskName } from "./_shims/contracts.js";
import { KillSwitchError, PermanentTaskError, type TaskHandlers, type TaskOutcome } from "./handlers.js";
import { type FlagSource, refusingFlag } from "./kill.js";
import type { Logger } from "./log.js";

/** UUIDv7 outbox ids are 36 chars; 128 leaves room for prefixed ids without allowing payloads. */
export const MAX_ID_LENGTH = 128;
export const MAX_IDS = 64;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;

export class InvalidTaskInputError extends PermanentTaskError {
  constructor(message: string) {
    super("INVALID_INPUT", message);
  }
}

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH && ID_PATTERN.test(v);

/** Arguments are ids only (S3.3). Anything else is refused before a handler sees it. */
export function validateIds(input: readonly unknown[]): string[] {
  if (input.length === 0) throw new InvalidTaskInputError("a task needs at least one id");
  if (input.length > MAX_IDS) throw new InvalidTaskInputError(`at most ${MAX_IDS} ids per run`);
  return input.map((v, i) => {
    if (!isId(v)) throw new InvalidTaskInputError(`argument ${i} is not an id`);
    return v;
  });
}

/**
 * The slice of `task_outbox` this wrapper writes. WS-DATA implements it in packages/outbox, e.g.
 * `UPDATE task_outbox SET state = 'dead', last_error = … WHERE id = $1 AND state <> 'done'`.
 * It must be idempotent; it is called once per id of a run that failed permanently.
 */
export interface OutboxPort {
  markFailed(id: string, code: string, detail: string): Promise<void>;
}

/** What every executor needs to run a task. Built once per process by wiring.ts. */
export interface TaskRuntime {
  readonly handlers: TaskHandlers;
  readonly outbox: OutboxPort;
  /** Fresh kill flags for a run; see kill.ts. */
  readonly readFlags: FlagSource;
}

export interface InvokeContext {
  readonly executor: ExecutorKind;
  readonly taskRunId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly logger: Logger;
  readonly now?: () => number;
}

export async function invokeTask(
  runtime: TaskRuntime,
  name: TaskName,
  rawIds: readonly unknown[],
  ctx: InvokeContext,
): Promise<TaskOutcome> {
  const now = ctx.now ?? Date.now;
  const started = now();
  const log = ctx.logger.child({ task: name, executor: ctx.executor, taskRunId: ctx.taskRunId });
  try {
    const ids = validateIds(rawIds);
    const flags = await runtime.readFlags(name, ids);
    const refused = refusingFlag(name, flags);
    if (refused) throw new KillSwitchError(name, `kill_${refused}`);
    const outcome = await runtime.handlers[name]({
      name,
      ids,
      executor: ctx.executor,
      taskRunId: ctx.taskRunId,
      signal: ctx.signal,
      flags,
    });
    log.info({ ids, status: outcome.status, ms: now() - started }, "task.run");
    return outcome;
  } catch (err) {
    const ms = now() - started;
    if (err instanceof PermanentTaskError) {
      // Record the dead row first. If that write fails, it throws out of here, so the run fails
      // visibly and the sweeper retries, instead of reporting success while the row stays `running`.
      const ids = rawIds.filter(isId).slice(0, MAX_IDS);
      for (const id of ids) await runtime.outbox.markFailed(id, err.code, err.message);
      log.warn({ code: err.code, ids, ms }, "task.run failed permanently");
      return { status: "failed", code: err.code, detail: err.message };
    }
    log.error({ err: err instanceof Error ? err.message : String(err), ms }, "task.run failed; retryable");
    throw err;
  }
}
