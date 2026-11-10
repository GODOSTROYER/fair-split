/**
 * I7 · every effect is enqueued in the transaction that requires it (IC-04 `enqueue(tx, name, args, dedupeKey)`).
 *
 * The row is inserted with `ON CONFLICT (dedupe_key) DO NOTHING`, so enqueueing the same logical task twice
 * (a retried request, a duplicate webhook, the PAID webhook racing the 60 s fallback under `fund:{invoiceId}:1`)
 * yields one row. The insert trigger sends `NOTIFY fs_outbox`, which Postgres delivers only if the transaction
 * commits: a rolled-back state change leaves no task behind, and a committed one can never lose its task.
 */
import { isTransaction, type JsonValue, schema as s, type Tx, toJsonObject } from "@fairsplit/db";
import { eq } from "drizzle-orm";
import { TASK_NAMES, type TaskName } from "./_shims/contracts.js";
import { jsonbBytes } from "./jsonb-size.js";

/** Task arguments are ids (Render Workflows caps arguments at 4 MB; we cap at 8 KB). */
export type TaskArgs = { [key: string]: JsonValue };

export interface EnqueueOptions {
  /** the workspace the task acts on; null for system tasks (reconcile, judgeReset, warmCaches) */
  workspaceId?: string | null;
  /** not before this instant (e.g. the 60 s funding fallback, settleBatch at +90 s) */
  runAfter?: Date;
  /** convenience for runAfter = now + delayMs */
  delayMs?: number;
  /** dead after this many attempts (default 8) */
  maxAttempts?: number;
}

export interface Enqueued {
  id: string;
  /** false when a task with this dedupe key already existed: the call was a no-op */
  inserted: boolean;
}

const TASKS = new Set<string>(TASK_NAMES);
export const MAX_ARGS_BYTES = 8192;

export async function enqueue(
  tx: Tx,
  name: TaskName,
  /** ids only; normalised to JSON (bigint → decimal string, Date → ISO), and that JSON is what handlers get */
  args: Record<string, unknown>,
  dedupeKey: string,
  opts: EnqueueOptions = {},
): Promise<Enqueued> {
  // is(), not instanceof: an app that resolves another copy of drizzle-orm must still be recognised (tx.ts)
  if (!isTransaction(tx)) {
    throw new TypeError("enqueue needs the transaction that makes the state change (I7), not the pool");
  }
  if (!TASKS.has(name)) throw new TypeError(`enqueue: unknown task ${name}`);
  if (!dedupeKey || dedupeKey.length > 200)
    throw new TypeError("enqueue: dedupeKey must be 1–200 characters");
  const json = toJsonObject(args, `${name}.args`);
  if (jsonbBytes(json) > MAX_ARGS_BYTES) {
    throw new RangeError(`enqueue: ${name} args exceed ${MAX_ARGS_BYTES} bytes; pass ids, not payloads`);
  }
  const runAfter = opts.runAfter ?? (opts.delayMs ? new Date(Date.now() + opts.delayMs) : undefined);
  const [row] = await tx
    .insert(s.taskOutbox)
    .values({
      name,
      args: json,
      dedupeKey,
      workspaceId: opts.workspaceId ?? null,
      ...(runAfter ? { runAfter } : {}),
      ...(opts.maxAttempts ? { maxAttempts: opts.maxAttempts } : {}),
    })
    .onConflictDoNothing({ target: s.taskOutbox.dedupeKey })
    .returning({ id: s.taskOutbox.id });
  if (row) return { id: row.id, inserted: true };
  const [existing] = await tx
    .select({ id: s.taskOutbox.id })
    .from(s.taskOutbox)
    .where(eq(s.taskOutbox.dedupeKey, dedupeKey));
  if (!existing) throw new Error(`enqueue: conflict on ${dedupeKey} but no row found`);
  return { id: existing.id, inserted: false };
}
