/**
 * Running one outbox task — the same code whichever executor hands it over (inline in fs-api, a Render
 * Workflows task in fs-tasks, or the background worker).
 *
 * Idempotent execution contract
 * 1. Claim. `UPDATE task_outbox SET state = 'running' … WHERE id = $id AND state IN ('queued','dispatched')
 *    RETURNING *` (S3.3). A duplicate delivery — a workflow start racing the 20 s inline fallback, a sweeper
 *    re-dispatch, a retried startTask — gets no row back and exits without running anything.
 * 2. Execute. Handlers load state by id and move it with optimistic transitions (`UPDATE … WHERE state =
 *    $expected`), so a second execution of the same task (after a crash between its commit and `done`) finds
 *    the state already moved and does nothing: at-least-once delivery, exactly-once effect.
 *    A handler whose effects are all in the database can call `ctx.complete(tx)` inside its own transaction to
 *    mark the task done atomically with them.
 * 3. Finish. Success → `done`. Failure → back to `queued` with exponential backoff, or `dead` after
 *    max_attempts. A heartbeat keeps `heartbeat_at` fresh; if the row is taken away (swept), the handler's
 *    AbortSignal fires.
 */
import { type Db, schema as s, type Tx } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import type { TaskName } from "./_shims/contracts.js";
import type { TaskArgs } from "./enqueue.js";

export type ExecutorKind = "inline" | "workflow" | "worker";

export interface TaskContext {
  outboxId: string;
  name: TaskName;
  workspaceId: string | null;
  /** 1 on the first run */
  attempt: number;
  executor: ExecutorKind;
  /** aborted if this run loses its claim (swept as stuck) */
  signal: AbortSignal;
  /** mark the task done inside the handler's own transaction (exactly-once for database-only effects) */
  complete(tx: Tx): Promise<void>;
}

export type TaskHandler = (args: TaskArgs, ctx: TaskContext) => Promise<void>;
export type TaskHandlers = Partial<Record<TaskName, TaskHandler>>;

export type RunOutcome =
  | { outcome: "done"; id: string }
  | { outcome: "retry"; id: string; error: string; runAfter: Date }
  | { outcome: "dead"; id: string; error: string }
  | { outcome: "skipped"; id: string; state: string | null };

export interface RunnerEvent {
  type: "claimed" | "done" | "retry" | "dead" | "skipped" | "lost";
  id: string;
  name?: string;
  attempt?: number;
  executor: ExecutorKind;
  error?: string;
}

export interface RunnerDeps {
  db: Db;
  handlers: TaskHandlers;
  /** identifies this process in claimed_by, e.g. "fs-api:<instance>" */
  workerId: string;
  heartbeatMs?: number;
  /** delay before attempt n+1 (default: 2^n s, capped at 5 min) */
  backoffMs?: (attempt: number) => number;
  onEvent?: (e: RunnerEvent) => void;
}

export const defaultBackoffMs = (attempt: number) => Math.min(300_000, 1000 * 2 ** Math.max(0, attempt - 1));

const MAX_ERROR = 2000;

export async function runTask(
  deps: RunnerDeps,
  outboxId: string,
  executor: ExecutorKind,
): Promise<RunOutcome> {
  const { db, workerId } = deps;
  const emit = deps.onEvent ?? (() => {});
  const t = s.taskOutbox;
  const [row] = await db
    .update(t)
    .set({
      state: "running",
      claimedBy: workerId,
      startedAt: sql`now()`,
      heartbeatAt: sql`now()`,
      attempts: sql`${t.attempts} + 1`,
      executor,
    })
    .where(
      and(
        eq(t.id, outboxId),
        sql`(${t.state} = 'dispatched' or (${t.state} = 'queued' and ${t.runAfter} <= now()))`,
      ),
    )
    .returning();
  if (!row) {
    const [cur] = await db.select({ state: t.state }).from(t).where(eq(t.id, outboxId));
    emit({ type: "skipped", id: outboxId, executor });
    return { outcome: "skipped", id: outboxId, state: cur?.state ?? null };
  }
  const name = row.name as TaskName;
  emit({ type: "claimed", id: row.id, name, attempt: row.attempts, executor });

  const mine = and(eq(t.id, row.id), eq(t.state, "running"), eq(t.claimedBy, workerId));
  const abort = new AbortController();
  const beat = setInterval(() => {
    void db
      .update(t)
      .set({ heartbeatAt: sql`now()` })
      .where(mine)
      .returning({ id: t.id })
      .then((r) => {
        if (r.length === 0 && !abort.signal.aborted) {
          emit({ type: "lost", id: row.id, name, executor });
          abort.abort(new Error("task claim lost"));
        }
      })
      .catch(() => {});
  }, deps.heartbeatMs ?? 30_000);
  beat.unref?.();

  const ctx: TaskContext = {
    outboxId: row.id,
    name,
    workspaceId: row.workspaceId,
    attempt: row.attempts,
    executor,
    signal: abort.signal,
    complete: async (tx) => {
      await tx.update(t).set({ state: "done", finishedAt: sql`now()`, lastError: null }).where(mine);
    },
  };

  try {
    const handler = deps.handlers[name];
    if (!handler) throw new Error(`no handler registered for task ${name}`);
    await handler(row.args as TaskArgs, ctx);
    const finished = await db
      .update(t)
      .set({ state: "done", finishedAt: sql`now()`, lastError: null })
      .where(mine)
      .returning({ id: t.id });
    // no row: already done by ctx.complete(tx) in the handler's transaction, or the claim was lost (swept)
    const outcome: RunOutcome =
      finished.length > 0 ? { outcome: "done", id: row.id } : await notMine(db, row.id);
    if (outcome.outcome === "done") emit({ type: "done", id: row.id, name, attempt: row.attempts, executor });
    return outcome;
  } catch (e) {
    const error = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, MAX_ERROR);
    if (row.attempts >= row.maxAttempts) {
      const moved = await db
        .update(t)
        .set({ state: "dead", finishedAt: sql`now()`, lastError: error, claimedBy: null })
        .where(mine)
        .returning({ id: t.id });
      if (moved.length === 0) return notMine(db, row.id);
      emit({ type: "dead", id: row.id, name, attempt: row.attempts, executor, error });
      return { outcome: "dead", id: row.id, error };
    }
    const runAfter = new Date(Date.now() + (deps.backoffMs ?? defaultBackoffMs)(row.attempts));
    const moved = await db
      .update(t)
      .set({ state: "queued", runAfter, lastError: error, claimedBy: null, executor: null })
      .where(mine)
      .returning({ id: t.id });
    if (moved.length === 0) return notMine(db, row.id);
    emit({ type: "retry", id: row.id, name, attempt: row.attempts, executor, error });
    return { outcome: "retry", id: row.id, error, runAfter };
  } finally {
    clearInterval(beat);
  }
}

/** The claim was lost (swept) or the handler already completed the row: report what the row says now. */
async function notMine(db: Db, id: string): Promise<RunOutcome> {
  const [cur] = await db
    .select({ state: s.taskOutbox.state })
    .from(s.taskOutbox)
    .where(eq(s.taskOutbox.id, id));
  if (cur?.state === "done") return { outcome: "done", id };
  return { outcome: "skipped", id, state: cur?.state ?? null };
}
