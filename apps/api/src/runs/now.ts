// "Do it now, through the outbox." A person's press that needs PayPal (mark paid, pay in cash) writes its task
// row in the transaction that requires it (I7), then runs that row inline in this request so the answer
// describes what happened. The task handler, running in this process, leaves a typed report here keyed by
// its outbox id; if the row ran elsewhere (the dispatcher took it first), the caller waits for the inline
// executor to be idle and answers from the database. Nothing here bypasses the outbox: a crash between the
// commit and the run leaves a queued row the dispatcher finishes.
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

/** Runs an enqueued row in this process and returns its report (null when it ran elsewhere or not at all). */
export async function runNow(deps: Pick<AppDeps, "outbox">, outboxId: string): Promise<TaskReport | null> {
  if (!deps.outbox) return null;
  const r = await deps.outbox.runTask(outboxId);
  if (r.outcome === "skipped") await deps.outbox.idle();
  const out = reports.get(outboxId) ?? null;
  reports.delete(outboxId);
  return out;
}

/** A failed report as the command's problem (codes the command lists). */
export function reportProblem(r: Extract<TaskReport, { ok: false }>): ApiProblem {
  return new ApiProblem(r.code, r.message, {
    ...(r.debugId ? { paypalDebugId: r.debugId } : {}),
    ...(r.retryAfterMs !== null ? { retryAfterMs: r.retryAfterMs } : {}),
  });
}
