// "Do it now, through the outbox." A person's press that needs PayPal (mark paid, pay in cash) writes its task
// row in the transaction that requires it (I7), then runs that row inline in this request so the answer
// describes what happened. The task handler, running in this process, leaves a typed report here keyed by
// its outbox id; if the row ran elsewhere (the dispatcher took it first), the caller waits for the inline
// executor to be idle and answers from the database. A row the outbox is retrying later (a 5xx, the 40/min
// window) is reported as QUEUED with when it runs again. Nothing here bypasses the outbox: a crash between
// the commit and the run leaves a queued row the dispatcher finishes.
import type { TaskName } from "@fairsplit/contracts";
import { schema, type Tx } from "@fairsplit/db";
import { type EnqueueOptions, enqueue } from "@fairsplit/outbox";
import { eq, like, or } from "drizzle-orm";
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
  if (out) return out;
  // Nothing ran here: the row is either finished (answer from the database) or waiting for its retry.
  const [row] = await deps.db
    .select({
      state: schema.taskOutbox.state,
      runAfter: schema.taskOutbox.runAfter,
      lastError: schema.taskOutbox.lastError,
    })
    .from(schema.taskOutbox)
    .where(eq(schema.taskOutbox.id, outboxId));
  if (row && row.state === "queued") {
    return {
      ok: false,
      code: "QUEUED",
      message: "The PayPal step is queued and will be retried shortly.",
      debugId: null,
      // run_after is the outbox's own (database) schedule, not domain time
      retryAfterMs: Math.max(1_000, row.runAfter.getTime() - Date.now()),
    };
  }
  return null;
}

/** A failed report as the command's problem (codes the command lists). */
export function reportProblem(r: Extract<TaskReport, { ok: false }>): ApiProblem {
  return new ApiProblem(r.code, r.message, {
    ...(r.debugId ? { paypalDebugId: r.debugId } : {}),
    ...(r.retryAfterMs !== null ? { retryAfterMs: r.retryAfterMs } : {}),
  });
}
