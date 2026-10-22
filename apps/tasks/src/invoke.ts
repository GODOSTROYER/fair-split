// The one wrapper every executor goes through: validate ids, call the injected handler, time it,
// log it, and classify failures (permanent -> `failed` outcome; transient -> rethrow for retry).
import type { ExecutorKind, TaskName } from "./_shims/contracts.js";
import { PermanentTaskError, type TaskHandlers, type TaskOutcome } from "./handlers.js";
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

/** Arguments are ids only (S3.3). Anything else is refused before a handler sees it. */
export function validateIds(input: readonly unknown[]): string[] {
  if (input.length === 0) throw new InvalidTaskInputError("a task needs at least one id");
  if (input.length > MAX_IDS) throw new InvalidTaskInputError(`at most ${MAX_IDS} ids per run`);
  return input.map((v, i) => {
    if (typeof v !== "string" || v.length === 0 || v.length > MAX_ID_LENGTH || !ID_PATTERN.test(v)) {
      throw new InvalidTaskInputError(`argument ${i} is not an id`);
    }
    return v;
  });
}

export interface InvokeContext {
  readonly executor: ExecutorKind;
  readonly taskRunId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly logger: Logger;
  readonly now?: () => number;
}

export async function invokeTask(
  handlers: TaskHandlers,
  name: TaskName,
  rawIds: readonly unknown[],
  ctx: InvokeContext,
): Promise<TaskOutcome> {
  const now = ctx.now ?? Date.now;
  const started = now();
  const log = ctx.logger.child({ task: name, executor: ctx.executor, taskRunId: ctx.taskRunId });
  try {
    const ids = validateIds(rawIds);
    const handler = handlers[name];
    const outcome = await handler({
      name,
      ids,
      executor: ctx.executor,
      taskRunId: ctx.taskRunId,
      signal: ctx.signal,
    });
    log.info({ ids, status: outcome.status, ms: now() - started }, "task.run");
    return outcome;
  } catch (err) {
    const ms = now() - started;
    if (err instanceof PermanentTaskError) {
      log.warn({ code: err.code, ms }, "task.run failed permanently");
      return { status: "failed", code: err.code, detail: err.message };
    }
    log.error({ err: err instanceof Error ? err.message : String(err), ms }, "task.run failed; retryable");
    throw err;
  }
}
