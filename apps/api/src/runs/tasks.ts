// Outbox task handlers of the runs slice (S3.3: money and webhook tasks run inline in fs-api). Each takes ids,
// loads its state, and moves it with compare-and-set, so running a task twice changes nothing (I7). A PayPal
// failure a retry can fix is thrown (the outbox retries with backoff), or, for a written batch, the parked
// item's cancel and a step waiting in Judge Mode's live lane, re-queued as a fresh attempt row due when the wait
// ends (runs/now.ts `deferTask`); PayPal's own refusal is recorded and the task completes. Every PayPal step of a
// judge workspace asks money/rail.ts first (live in the lane, or a labelled replay that calls nothing). When a
// person's press runs the task inline, the handler leaves a report for it (runs/now.ts).
import { type PayRunState, TASKS, TaskArgs } from "@fairsplit/contracts";
import { type Actor, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import type { TaskContext, TaskHandler, TaskHandlers } from "@fairsplit/outbox";
import { type BatchOutcome, PayoutsApiError } from "@fairsplit/paypal-payouts";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { sendApprovalFor } from "../agent/tasks.js";
import { settlementOf, withArmedTamper } from "../judge/index.js";
import type { AppDeps } from "../lib/context.js";
import { classifyPayPal, PayPalStepError } from "../money/errors.js";
import { confirmFunding, ensureInvoiceSent, recordPaymentAndFund } from "../money/funding.js";
import {
  guardResumedPrimary,
  payoutsRepository,
  payoutsServiceFor,
  refusedByKillSwitch,
  sendBackChecked,
} from "../money/payouts.js";
import { LaneQueued, notReplayable, railForItem, railForStep } from "../money/rail.js";
import { advanceRun, processWebhook, settleBatch } from "../money/settle.js";
import { recomputeRun } from "./engine.js";
import { ACTORS } from "./events.js";
import { readKill } from "./flags.js";
import { lockRun } from "./load.js";
import { cause, moveLine, moveRun } from "./machine.js";
import { attemptsOf, deferDelayMs, deferTask, earlierAttempt, outboxRetryAfterMs, report } from "./now.js";

function scopeOf(ctx: TaskContext, actor: Actor = ACTORS.outbox) {
  if (!ctx.workspaceId) throw new Error(`${ctx.name} needs the workspace of its outbox row`);
  return systemScope(ctx.workspaceId, actor);
}

/**
 * Wraps a PayPal step: a report for an inline caller; transient failures rethrown for the outbox to retry. With
 * `defer` (a deps), a transient failure re-queues the task instead as the next attempt row of its press, due when
 * the step said to try again (`deferTask`): the outbox's own budget (8 attempts, seconds apart, about two minutes)
 * cannot outlast PayPal's 6-minute circuit, a kill switch held for an hour or the live lane's queue, and ignores
 * the wait it was given. `deferOnly` narrows which transient failures are re-queued that way.
 */
function paypalTask(
  fn: (args: Record<string, unknown>, ctx: TaskContext) => Promise<Record<string, unknown> | undefined>,
  o: { defer?: Pick<AppDeps, "db">; deferOnly?: (step: PayPalStepError) => boolean } = {},
): TaskHandler {
  return async (args, ctx) => {
    try {
      const detail = await fn(args, ctx);
      report(ctx.outboxId, { ok: true, ...(detail ? { detail } : {}) });
    } catch (e) {
      const step = classifyPayPal(e, ctx.name);
      if (step.opts.transient && o.defer && (o.deferOnly?.(step) ?? true)) {
        const attempts = await attemptsOf(o.defer.db, ctx.outboxId);
        const next = await deferTask(o.defer.db, ctx, args, deferDelayMs(step.opts.retryAfterMs, attempts));
        if (next) {
          report(ctx.outboxId, {
            ok: false,
            code: step.code,
            message: step.message,
            debugId: step.opts.debugId ?? null,
            retryAfterMs: outboxRetryAfterMs(next.runAfter),
          });
          return;
        }
      }
      report(ctx.outboxId, {
        ok: false,
        code: step.code,
        message: step.message,
        debugId: step.opts.debugId ?? null,
        retryAfterMs: step.opts.retryAfterMs ?? null,
      });
      if (step.opts.transient) throw step;
    }
  };
}

/**
 * The batch POST on the rail it was given (live, or Judge Mode's replay): `PayoutsService.executeApproved` inside
 * "change one payout after both keys" (judge/tamper.ts `withArmedTamper`, a no-op outside judge workspaces), so an
 * armed change meets the post and I4 refuses it, live or replayed. `seen` gets the outcome for the reservation.
 */
async function post(
  deps: AppDeps,
  scope: ReturnType<typeof systemScope>,
  args: { runId: string; senderBatchId: string },
  seen: (outcome: BatchOutcome) => void,
): Promise<Record<string, unknown>> {
  const repo = payoutsRepository(deps, scope);
  const service = await payoutsServiceFor(deps, scope, { repo: () => repo });
  const outcome = await withArmedTamper(deps, { scope, runId: args.runId }, () =>
    service.executeApproved(args.runId),
  );
  seen(outcome);
  const rail = deps.paypal.provenance === "replay" ? "replay" : "live";
  switch (outcome.kind) {
    case "created":
    case "adopted":
      return { outcome: outcome.kind, payoutBatchId: outcome.payoutBatchId, rail };
    case "rejected":
      return { outcome: "rejected", status: outcome.status, name: outcome.name, rail };
    case "unresolved":
      throw new PayPalStepError(
        "QUEUED",
        `The POST is unresolved (${outcome.reason}); it resumes with the same ids.`,
        {
          transient: true,
          retryAfterMs: 30_000,
          debugId: outcome.debugId,
        },
      );
    case "refused": {
      // The rows are written (QUEUED: the limiter window; CIRCUIT_OPEN: a 429): the post waits as the press's
      // next attempt row, due when PayPal's pacing ends, and resumes with the same ids (I4 re-checked).
      if (outcome.code === "CIRCUIT_OPEN" || outcome.code === "QUEUED") {
        throw new PayPalStepError(outcome.code, outcome.reason, {
          transient: true,
          retryAfterMs: outcome.code === "CIRCUIT_OPEN" ? 6 * 60_000 : 30_000,
        });
      }
      if (outcome.code === "KILL_SWITCH_ON") {
        // HALT (kill_payouts), send back (kill_paypal_live), or wait (rows already written, re-queued until the
        // switch is off): never parked
        const runState = await refusedByKillSwitch(deps, scope, args.runId, outcome);
        return { outcome: "refused", code: outcome.code, runState, rail };
      }
      if (outcome.code === "ADOPT_FAILED") {
        deps.logger.error(
          { runId: args.runId, reason: outcome.reason },
          "payout adopt failed: the batch needs a person",
        );
        return { outcome: "refused", code: outcome.code, rail };
      }
      // Nothing was sent. A failed approval check was already sent back by the service (repo.voidApprovals,
      // a compare-and-set); any other refusal of what this attempt checked (a sandbox guard, the daily cap,
      // an invalid batch) is sent back under the same compare-and-set: only while the run is APPROVED and
      // its live approvals are exactly those this attempt checked, so a stale executor never voids a newer
      // signing, and a run another executor moved to POSTING is left alone.
      const nonces = repo.checkedNonces(args.runId);
      const sentBack = nonces
        ? await sendBackChecked(deps, scope, {
            runId: args.runId,
            nonces,
            code: outcome.code,
            reason: outcome.reason,
            senderBatchId: outcome.senderBatchId,
            at: deps.clock.now(),
          })
        : null;
      const [now] = await deps.db
        .select({ state: schema.payRuns.state })
        .from(schema.payRuns)
        .where(and(eq(schema.payRuns.workspaceId, scope.workspaceId), eq(schema.payRuns.id, args.runId)));
      return { outcome: "refused", code: outcome.code, runState: sentBack ?? now?.state ?? null, rail };
    }
  }
}

export function runTasks(deps: AppDeps): TaskHandlers {
  return {
    ensureInvoice: paypalTask(
      async (raw, ctx) => {
        const args = TaskArgs.ensureInvoice.parse(raw);
        const scope = scopeOf(ctx);
        // Judge Mode decides live or replay (and takes the lane) before any PayPal call (money/rail.ts).
        const rail = await railForStep(deps, {
          workspaceId: scope.workspaceId,
          runId: args.runId,
          step: args.target === "SENT" ? "invoice" : "fund",
        });
        if (rail.kind === "queued") throw new LaneQueued(rail);
        try {
          // kill_paypal_live: a refusal live (in Judge Mode it already made the step a labelled replay)
          if (rail.kind === "live" && (await readKill(deps, scope.workspaceId)).killPaypalLive) {
            throw new PayPalStepError("KILL_SWITCH_ON", "PayPal calls are paused by the kill switch.", {
              transient: false,
            });
          }
          if (args.target === "SENT") {
            const out = await ensureInvoiceSent(rail.deps, scope, args.runId, {
              approval: await sendApprovalFor(deps, scope.workspaceId, args.runId),
            });
            return { state: out.state, invoiceId: out.invoiceId, reason: out.reason, rail: rail.kind };
          }
          const out = await confirmFunding(rail.deps, scope, args.runId);
          return { funded: out.funded, runState: out.runState, rail: rail.kind };
        } finally {
          if (rail.kind === "live") await rail.end();
        }
      },
      { defer: deps, deferOnly: (s) => s instanceof LaneQueued },
    ),

    recordPayment: paypalTask(
      async (raw, ctx) => {
        const args = TaskArgs.recordPayment.parse(raw);
        const scope = scopeOf(ctx);
        const rail = await railForStep(deps, {
          workspaceId: scope.workspaceId,
          runId: args.runId,
          step: "fund",
        });
        if (rail.kind === "queued") throw new LaneQueued(rail);
        try {
          if (rail.kind === "live" && (await readKill(deps, scope.workspaceId)).killPaypalLive) {
            throw new PayPalStepError("KILL_SWITCH_ON", "PayPal calls are paused by the kill switch.", {
              transient: false,
            });
          }
          // S3.10: a retry GETs first (an earlier attempt may have recorded the payment and lost the answer)
          const retry = await earlierAttempt(deps.db, TASKS.recordPayment.dedupeKey(args), ctx);
          const out = await recordPaymentAndFund(rail.deps, scope, args.runId, { retry });
          return {
            funded: out.funded,
            runState: out.runState,
            invoiceStatus: out.snapshot.status,
            rail: rail.kind,
          };
        } finally {
          if (rail.kind === "live") await rail.end();
        }
      },
      { defer: deps, deferOnly: (s) => s instanceof LaneQueued },
    ),

    postPayoutBatch: paypalTask(
      async (raw, ctx) => {
        const args = TaskArgs.postPayoutBatch.parse(raw);
        const scope = scopeOf(ctx);
        // Judge Mode: a fresh decision, the single-flight lane and the post's reservation, all before PayPal.
        const rail = await railForStep(deps, {
          workspaceId: scope.workspaceId,
          runId: args.runId,
          step: "post",
        });
        if (rail.kind === "queued") throw new LaneQueued(rail);
        if (rail.kind === "done") {
          // PayPal already answered this batch (Judge Mode): nothing is sent and no slot is taken
          if (rail.reason === "adopt_failed") {
            deps.logger.error(
              { runId: args.runId },
              "payout adopt failed: the batch needs a person; it is not posted again",
            );
          }
          return {
            outcome: "refused",
            code: rail.reason === "adopt_failed" ? "ADOPT_FAILED" : "ALREADY_ANSWERED",
            payoutBatchId: rail.payoutBatchId,
            rail: "live",
          };
        }
        let outcome: BatchOutcome | null = null;
        try {
          // outside Judge Mode, rows written and resumed later: C-21 again at this POST, which it is then counted from
          await guardResumedPrimary(rail.deps, scope, args.runId);
          return await post(rail.deps, scope, args, (o) => {
            outcome = o;
          });
        } finally {
          // the reservation settles with what PayPal did (posted, denied, nothing); unresolved stays open
          if (rail.kind === "live") await rail.end(settlementOf(outcome));
        }
      },
      { defer: deps },
    ),

    settleBatch: async (raw, ctx) => {
      const args = TaskArgs.settleBatch.parse(raw);
      try {
        await settleBatch(deps, args, ctx);
      } catch (e) {
        const step = classifyPayPal(e, "the settle GET");
        if (step.opts.transient) throw step;
        deps.logger.warn({ batchId: args.batchId, code: step.code }, "settle GET refused");
      }
    },

    processWebhook: async (raw, ctx) => {
      const args = TaskArgs.processWebhook.parse(raw);
      await processWebhook(deps, args, ctx);
    },

    computeRun: async (raw, ctx) => {
      const args = TaskArgs.computeRun.parse(raw);
      const scope = scopeOf(ctx, ACTORS.engine);
      await withWorkspaceTx(deps.db, scope, async (tx) => {
        let run = await lockRun(tx, scope, args.runId);
        const at = deps.clock.now();
        const o = { at, actor: ACTORS.engine, provenance: "live" as const };
        if (run.state === "EXTRACTING") {
          const [unread] = await tx
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.workspaceId, scope.workspaceId),
                eq(schema.documents.seasonId, run.seasonId),
                eq(schema.documents.kind, "slip_photo"),
                isNull(schema.documents.exactDuplicateOf),
                notExists(
                  tx
                    .select({ one: sql`1` })
                    .from(schema.slipRows)
                    .where(eq(schema.slipRows.documentId, schema.documents.id)),
                ),
              ),
            )
            .limit(1);
          if (unread) {
            await ctx.complete(tx); // the reader enqueues computeRun again once every photo is read
            return;
          }
          await recomputeRun(tx, scope, run, o);
          run = await moveRun(tx, scope, {
            id: run.id,
            from: "EXTRACTING",
            to: "COMPUTED",
            version: run.version,
            cause: cause("ROWS_SETTLED"),
            provenance: "live",
            actor: ACTORS.engine,
          });
        } else if (run.state === "IN_REVIEW") {
          await recomputeRun(tx, scope, run, o);
        }
        if (run.state === "COMPUTED") {
          await moveRun(tx, scope, {
            id: run.id,
            from: "COMPUTED",
            to: "IN_REVIEW",
            version: run.version,
            cause: cause("OPEN_REVIEW"),
            provenance: "live",
            actor: ACTORS.engine,
          });
        }
        await ctx.complete(tx);
      });
    },
  };
}

export function lineTasks(deps: AppDeps): TaskHandlers {
  return {
    cancelUnclaimed: paypalTask(
      async (raw, ctx) => {
        const args = TaskArgs.cancelUnclaimed.parse(raw);
        const scope = scopeOf(ctx);
        // A replayed item is cancelled on the replay rail; a live one through the judge lane, never replayed.
        const [found] = await deps.db
          .select({ provenance: schema.payoutItems.provenance, runId: schema.memberLines.runId })
          .from(schema.payoutItems)
          .innerJoin(schema.memberLines, eq(schema.memberLines.id, schema.payoutItems.lineId))
          .where(
            and(
              eq(schema.payoutItems.workspaceId, scope.workspaceId),
              eq(schema.payoutItems.payoutItemId, args.payoutItemId),
            ),
          );
        const rail = found
          ? await railForItem(deps, {
              workspaceId: scope.workspaceId,
              runId: found.runId,
              step: "cancel",
              itemProvenance: found.provenance,
            })
          : ({ kind: "live", deps, end: async () => undefined } as const);
        if (rail.kind === "queued") throw new LaneQueued(rail);
        if (rail.kind === "refused") throw notReplayable(rail.decision);
        try {
          return await cancel(rail.deps, scope, args);
        } finally {
          if (rail.kind === "live") await rail.end();
        }
      },
      { defer: deps },
    ),
  };
}

/** The parked item's cancel on the rail it was given (the `cancelUnclaimed` task's body). */
async function cancel(
  deps: AppDeps,
  scope: ReturnType<typeof systemScope>,
  args: { payoutItemId: string; afterCancel: "cash" | "reroute" },
): Promise<Record<string, unknown>> {
  const service = await payoutsServiceFor(deps, scope);
  let outcome: Awaited<ReturnType<typeof service.cancelUnclaimed>>;
  try {
    outcome = await service.cancelUnclaimed(args.payoutItemId, ACTORS.outbox, args.afterCancel);
  } catch (e) {
    if (e instanceof PayoutsApiError) {
      if (e.status === 429) {
        throw new PayPalStepError(
          "CIRCUIT_OPEN",
          "The simulated PayPal sandbox is pacing us; the cancel waits.",
          {
            transient: true,
            retryAfterMs: 6 * 60_000,
            debugId: e.debugId,
            status: 429,
          },
        );
      }
      throw new PayPalStepError("PAYPAL_REJECTED", `PayPal refused the cancel (${e.paypalName}).`, {
        transient: false,
        debugId: e.debugId,
        status: e.status,
      });
    }
    throw e;
  }
  switch (outcome.kind) {
    case "RETURNED": {
      if (args.afterCancel === "cash") {
        await withWorkspaceTx(deps.db, scope, async (tx) => {
          const [row] = await tx
            .select({
              item: schema.payoutItems,
              memberNo: schema.members.memberNo,
              line: schema.memberLines,
            })
            .from(schema.payoutItems)
            .innerJoin(schema.memberLines, eq(schema.memberLines.id, schema.payoutItems.lineId))
            .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
            .where(
              and(
                eq(schema.payoutItems.workspaceId, scope.workspaceId),
                eq(schema.payoutItems.payoutItemId, args.payoutItemId),
              ),
            );
          if (row?.line.state === "RETURNED") {
            await moveLine(tx, scope, {
              id: row.line.id,
              memberNo: row.memberNo,
              runId: row.line.runId,
              from: "RETURNED",
              to: "OFF_RAIL_DUE",
              version: row.line.version,
              cause: cause("MOVED_TO_CASH", args.payoutItemId),
              provenance: "live",
              actor: ACTORS.outbox,
            });
          }
          if (row) await advanceRun(tx, scope, row.line.runId, deps.paypal.provenance);
        });
      }
      return { outcome: "RETURNED" };
    }
    case "NOT_UNCLAIMED":
      throw new PayPalStepError(
        "INVALID_TRANSITION",
        `The item is ${outcome.status ?? "no longer unclaimed"}; nothing was cancelled.`,
        { transient: false },
      );
    case "REFUSED":
      // PayPal's pacing (the limiter window, the 429 circuit): nothing was sent, the intent stays recorded
      // and the outbox retries the cancel later.
      if (outcome.code === "QUEUED" || outcome.code === "CIRCUIT_OPEN") {
        throw new PayPalStepError(
          "CIRCUIT_OPEN",
          "The simulated PayPal sandbox is pacing us; the cancel waits.",
          {
            transient: true,
            retryAfterMs: outcome.code === "CIRCUIT_OPEN" ? 6 * 60_000 : 30_000,
          },
        );
      }
      throw new PayPalStepError(
        outcome.code === "KILL_SWITCH_ON" ? "KILL_SWITCH_ON" : "INVALID_TRANSITION",
        outcome.code === "KILL_SWITCH_ON"
          ? "Refused: payouts are paused by the co-op."
          : `The cancel was refused (${outcome.code}).`,
        { transient: false },
      );
    case "UNRESOLVED":
      throw new PayPalStepError(
        "CIRCUIT_OPEN",
        `PayPal did not confirm the cancel (${outcome.reason}); it will be retried.`,
        {
          transient: true,
          retryAfterMs: 30_000,
        },
      );
  }
}

/** For reads: is a run past the point of no return? */
export const POSTED_OR_LATER: readonly PayRunState[] = [
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
  "CLOSED",
];
