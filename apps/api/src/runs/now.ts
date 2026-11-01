// "Do it now, through the outbox." A person's press that needs PayPal (mark paid, pay in cash) writes its task
// row in the transaction that requires it (I7), then runs that row inline in this request so the answer
// describes what happened. The task handler, running in this process, leaves a typed report here keyed by
// its outbox id; if the row ran elsewhere (the dispatcher took it first), the caller waits for the inline
// executor to be idle and answers from the database. A row the outbox is retrying later (a 5xx, the 40/min
// window) is reported as QUEUED with when it runs again. Nothing here bypasses the outbox: a crash between
// the commit and the run leaves a queued row the dispatcher finishes.
import type { TaskName } from "@fairsplit/contracts";
import { type DbOrTx, inTransaction, schema, type Tx } from "@fairsplit/db";
import { type EnqueueOptions, enqueue } from "@fairsplit/outbox";
import { and, eq, like, ne, or } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem } from "../lib/problem.js";
import type { StepCode } from "../money/errors.js";

export type TaskReport =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; code: StepCode; message: string; debugId: string | null; retryAfterMs: number | null };

const MAX_REPORTS = 1_000;
const reports = new Map<string, TaskReport>();

/** Called by a task handler with its `ctx.outboxId`. */
export function report(outboxId: string, r: TaskReport): void {
  reports.set(outboxId, r);
  if (reports.size > MAX_REPORTS) {
    const oldest = reports.keys().next().value;
    if (oldest !== undefined) reports.delete(oldest);
  }
}

/**
 * Enqueues a person's press. The canonical dedupe key (`TASKS[name].dedupeKey`) is used while its row is in
 * flight, so a double press runs once; once that row finished (done or dead) and the state still allows the
 * press, a new attempt row `{key}:r{n}` is written: a refusal PayPal gave yesterday never blocks today's press.
 */
export async function enqueuePress(
  tx: Tx,
  name: TaskName,
  args: Record<string, unknown>,
  dedupeKey: string,
  opts: EnqueueOptions,
): Promise<string> {
  const rows = await tx
    .select({ id: schema.taskOutbox.id, state: schema.taskOutbox.state, key: schema.taskOutbox.dedupeKey })
    .from(schema.taskOutbox)
    .where(
      or(eq(schema.taskOutbox.dedupeKey, dedupeKey), like(schema.taskOutbox.dedupeKey, `${dedupeKey}:r%`)),
    );
  const live = rows.find((r) => r.state === "queued" || r.state === "dispatched" || r.state === "running");
  if (live) return live.id;
  const key = rows.length === 0 ? dedupeKey : `${dedupeKey}:r${rows.length}`;
  return (await enqueue(tx, name, args, key, opts)).id;
}

const LIVE_STATES = ["queued", "dispatched", "running"] as const;

/** Retry slightly after the database's outbox schedule, leaving time for the dispatcher to claim it. */
export function outboxRetryAfterMs(runAfter: Date): number {
  return Math.max(1_000, runAfter.getTime() - Date.now() + 500);
}

/** The press a row belongs to: its dedupe key without the `:r{n}` attempt suffix (enqueuePress, deferTask). */
export function pressKeyOf(dedupeKey: string): string {
  return dedupeKey.replace(/:r\d+$/, "");
}

/** Rows a press may write before it stops re-queuing itself (about a day at the longest wait). */
export const MAX_ATTEMPT_ROWS = 100;
/** The longest a deferred attempt waits: whatever PayPal or a person set, the step is tried again by then. */
export const MAX_DEFER_MS = 15 * 60_000;

/** How long attempt n + 1 waits: what the step asked for, growing with the attempts already made (capped). */
export function deferDelayMs(retryAfterMs: number | null | undefined, attempts: number): number {
  const asked = Number.isFinite(retryAfterMs) && (retryAfterMs ?? 0) > 0 ? (retryAfterMs as number) : 30_000;
  const grown = 15_000 * 2 ** Math.max(0, Math.min(10, attempts - 1));
  return Math.min(MAX_DEFER_MS, Math.max(asked, grown));
}

export interface Deferred {
  /** The attempt row that runs next. */
  id: string;
  runAfter: Date;
}

/**
 * Re-queues a task as the next attempt row of its press (`{press}:r{n}`, the scheme `enqueuePress` uses), due after
 * `delayMs`, so the row that is running can finish. The outbox's own retry budget (8 attempts, seconds apart:
 * about two minutes) never runs out on a wait PayPal or a person sets (the 6-minute circuit, a kill switch held for
 * an hour, the live lane's queue), and the retry honours the wait it was given. When another attempt of the press
 * is already waiting, that one stands (nothing is added). Null when the press has used MAX_ATTEMPT_ROWS rows: the
 * caller then fails the row the ordinary way (the catch-up resumes a stalled post).
 */
export async function deferTask(
  db: DbOrTx,
  run: { outboxId: string; name: TaskName; workspaceId: string | null },
  args: Record<string, unknown>,
  delayMs: number,
): Promise<Deferred | null> {
  const t = schema.taskOutbox;
  const go = async (tx: Tx): Promise<Deferred | null> => {
    const [me] = await tx.select({ key: t.dedupeKey }).from(t).where(eq(t.id, run.outboxId));
    if (!me) return null;
    const press = pressKeyOf(me.key);
    const rows = await tx
      .select({ id: t.id, state: t.state, runAfter: t.runAfter })
      .from(t)
      .where(or(eq(t.dedupeKey, press), like(t.dedupeKey, `${press}:r%`)));
    const waiting = rows.find(
      (r) => r.id !== run.outboxId && (LIVE_STATES as readonly string[]).includes(r.state),
    );
    if (waiting) return { id: waiting.id, runAfter: waiting.runAfter };
    if (rows.length >= MAX_ATTEMPT_ROWS) return null;
    // the outbox's schedule is the database's (real) clock, not domain time
    const runAfter = new Date(Date.now() + Math.max(1_000, delayMs));
    const next = await enqueue(tx, run.name, args, `${press}:r${rows.length}`, {
      workspaceId: run.workspaceId,
      runAfter,
    });
    return { id: next.id, runAfter };
  };
  return inTransaction(db, go);
}

/** The attempt rows a press has written so far (finished or not). */
export async function attemptsOf(db: DbOrTx, outboxId: string): Promise<number> {
  const t = schema.taskOutbox;
  const [me] = await db.select({ key: t.dedupeKey }).from(t).where(eq(t.id, outboxId));
  if (!me) return 1;
  const press = pressKeyOf(me.key);
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(or(eq(t.dedupeKey, press), like(t.dedupeKey, `${press}:r%`)));
  return Math.max(1, rows.length);
}

/**
 * Whether a press may already have reached PayPal before this run of its task: this outbox row ran before
 * (the outbox retries it), or an earlier attempt row of the same press exists (`{key}`, `{key}:r{n}`).
 */
export async function earlierAttempt(
  db: DbOrTx,
  dedupeKey: string,
  run: { outboxId: string; attempt: number },
): Promise<boolean> {
  if (run.attempt > 1) return true;
  const t = schema.taskOutbox;
  const [other] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(or(eq(t.dedupeKey, dedupeKey), like(t.dedupeKey, `${dedupeKey}:r%`)), ne(t.id, run.outboxId)))
    .limit(1);
  return other !== undefined;
}

/** Runs an enqueued row in this process and returns its report (null when it finished elsewhere). */
export async function runNow(
  deps: Pick<AppDeps, "outbox" | "db">,
  outboxId: string,
): Promise<TaskReport | null> {
  if (!deps.outbox) return null;
  const r = await deps.outbox.runTask(outboxId);
  if (r.outcome === "skipped") await deps.outbox.idle();
  const out = reports.get(outboxId) ?? null;
  reports.delete(outboxId);
  if (out?.ok) return out;
  // Nothing ran here: the row is either finished (answer from the database) or waiting for its retry.
  const [row] = await deps.db
    .select({
      state: schema.taskOutbox.state,
      runAfter: schema.taskOutbox.runAfter,
      lastError: schema.taskOutbox.lastError,
    })
    .from(schema.taskOutbox)
    .where(eq(schema.taskOutbox.id, outboxId));
  if (row && (LIVE_STATES as readonly string[]).includes(row.state)) {
    return {
      ok: false,
      code: out?.code ?? "QUEUED",
      message: out?.message ?? "The PayPal step is queued and will be retried shortly.",
      debugId: out?.debugId ?? null,
      // run_after is the outbox's own (database) schedule, not domain time
      retryAfterMs: outboxRetryAfterMs(row.runAfter),
    };
  }
  return out;
}

/** A failed report as the command's problem (codes the command lists). */
export function reportProblem(r: Extract<TaskReport, { ok: false }>): ApiProblem {
  return new ApiProblem(r.code, r.message, {
    ...(r.debugId ? { paypalDebugId: r.debugId } : {}),
    ...(r.retryAfterMs !== null ? { retryAfterMs: r.retryAfterMs } : {}),
  });
}
