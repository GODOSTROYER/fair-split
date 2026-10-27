// HANDOFF to WS-DATA (packages/outbox), with ./dispatcher.ts. NOT EXPORTED from @fairsplit/tasks.
//
// Render's `startTask` idempotency key (@renderinc/sdk 1.3.0, `IdempotencyKey`): "Repeating a request
// with the same key within 24 hours returns the task run that the first request started instead of
// starting another one." A key derived from the outbox row alone therefore breaks every re-dispatch:
// the sweeper re-queues a failed row, the dispatcher starts it again with the same key, Render hands
// back the earlier failed run, and nothing executes until the row goes `dead`.
//
// The key is scoped to one dispatch attempt instead. Retrying the SAME `startTask` call (a timeout
// or a 5xx on the request itself) reuses the key and gets the same run back, so a network blip never
// starts two runs; the next dispatch attempt gets a new key and therefore a new run.
import { createHash } from "node:crypto";

/** Longer id lists are hashed, so the key stays short whatever Render's (undocumented) length limit is. */
export const MAX_PLAIN_KEY_IDS_LENGTH = 160;

/**
 * The idempotency key for one dispatch of a run's outbox rows. `attempt` must change on every
 * dispatch of the row (a dispatch counter; `task_outbox.attempts` qualifies only if the dispatcher,
 * not the runner, increments it). If it ever repeats, the dispatcher still recovers: a run that
 * Render reports finished before it was ever seen running is treated as not picked up, and an old
 * run that never starts hits the 20 s inline fallback.
 */
export function renderIdempotencyKey(outboxIds: readonly string[], attempt: number): string {
  if (outboxIds.length === 0) throw new Error("renderIdempotencyKey needs at least one outbox id");
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new Error("attempt must be a non-negative integer");
  }
  const ids = outboxIds.join("+");
  const scope =
    ids.length <= MAX_PLAIN_KEY_IDS_LENGTH ? ids : `h${createHash("sha256").update(ids).digest("hex")}`;
  return `${scope}:a${attempt}`;
}
