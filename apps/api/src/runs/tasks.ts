// Outbox task handlers of the runs slice (S3.3: money and webhook tasks run inline in fs-api). Each takes ids,
// loads its state, and moves it with compare-and-set, so running a task twice changes nothing (I7). A PayPal
// failure a retry can fix is thrown (the outbox retries with backoff); PayPal's own refusal is recorded and
// the task completes. When a person's press runs the task inline, the handler leaves a report for it
// (runs/now.ts).
import { type PayRunState, TaskArgs } from "@fairsplit/contracts";
import { type Actor, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import type { TaskContext, TaskHandler, TaskHandlers } from "@fairsplit/outbox";
import { PayoutsApiError } from "@fairsplit/paypal-payouts";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { sendApprovalFor } from "../agent/tasks.js";
import type { AppDeps } from "../lib/context.js";
import { classifyPayPal, PayPalStepError } from "../money/errors.js";
import { confirmFunding, ensureInvoiceSent, recordPaymentAndFund } from "../money/funding.js";
import { payoutsServiceFor, refusedByKillSwitch, sendBack } from "../money/payouts.js";
import { advanceRun, processWebhook, settleBatch } from "../money/settle.js";
import { recomputeRun } from "./engine.js";
import { ACTORS } from "./events.js";
import { readKill } from "./flags.js";
import { lockRun } from "./load.js";
import { cause, moveLine, moveRun } from "./machine.js";
import { report } from "./now.js";

function scopeOf(ctx: TaskContext, actor: Actor = ACTORS.outbox) {
  if (!ctx.workspaceId) throw new Error(`${ctx.name} needs the workspace of its outbox row`);
  return systemScope(ctx.workspaceId, actor);
}

/** Wraps a PayPal step: a report for an inline caller; transient failures rethrown for the outbox to retry. */
function paypalTask(
  fn: (args: Record<string, unknown>, ctx: TaskContext) => Promise<Record<string, unknown> | undefined>,
): TaskHandler {
  return async (args, ctx) => {
    try {
      const detail = await fn(args, ctx);
      report(ctx.outboxId, { ok: true, ...(detail ? { detail } : {}) });
    } catch (e) {
      const step = classifyPayPal(e, ctx.name);
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

export function runTasks(deps: AppDeps): TaskHandlers {
  return {
    ensureInvoice: paypalTask(async (raw, ctx) => {
      const args = TaskArgs.ensureInvoice.parse(raw);
      const scope = scopeOf(ctx);
      if ((await readKill(deps, scope.workspaceId)).killPaypalLive) {
        throw new PayPalStepError("KILL_SWITCH_ON", "PayPal calls are paused by the kill switch.", {
          transient: false,
        });
      }
      if (args.target === "SENT") {
        const out = await ensureInvoiceSent(deps, scope, args.runId, {
          approval: await sendApprovalFor(deps, scope.workspaceId, args.runId),
        });
        return { state: out.state, invoiceId: out.invoiceId, reason: out.reason };
      }
      const out = await confirmFunding(deps, scope, args.runId);
      return { funded: out.funded, runState: out.runState };
    }),

    recordPayment: paypalTask(async (raw, ctx) => {
      const args = TaskArgs.recordPayment.parse(raw);
      const scope = scopeOf(ctx);
      if ((await readKill(deps, scope.workspaceId)).killPaypalLive) {
        throw new PayPalStepError("KILL_SWITCH_ON", "PayPal calls are paused by the kill switch.", {
          transient: false,
        });
      }
      const out = await recordPaymentAndFund(deps, scope, args.runId);
      return { funded: out.funded, runState: out.runState, invoiceStatus: out.snapshot.status };
    }),

    postPayoutBatch: paypalTask(async (raw, ctx) => {
      const args = TaskArgs.postPayoutBatch.parse(raw);
      const scope = scopeOf(ctx);
      const service = await payoutsServiceFor(deps, scope);
      const outcome = await service.executeApproved(args.runId);
      switch (outcome.kind) {
        case "created":
        case "adopted":
          return { outcome: outcome.kind, payoutBatchId: outcome.payoutBatchId };
        case "rejected":
          return { outcome: "rejected", status: outcome.status, name: outcome.name };
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
          if (outcome.code === "CIRCUIT_OPEN") {
            throw new PayPalStepError("CIRCUIT_OPEN", outcome.reason, {
              transient: true,
              retryAfterMs: 6 * 60_000,
            });
          }
          if (outcome.code === "KILL_SWITCH_ON") {
            // HALT (kill_payouts), send back (kill_paypal_live), or wait (rows already written): never parked
            const runState = await refusedByKillSwitch(deps, scope, args.runId, outcome);
            return { outcome: "refused", code: outcome.code, runState };
          }
          if (outcome.code === "ADOPT_FAILED") {
            deps.logger.error(
              { runId: args.runId, reason: outcome.reason },
              "payout adopt failed: the batch needs a person",
            );
            return { outcome: "refused", code: outcome.code };
          }
          const state = await sendBack(deps, scope, args.runId, outcome);
          return { outcome: "refused", code: outcome.code, runState: state };
        }
      }
    }),

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
    cancelUnclaimed: paypalTask(async (raw, ctx) => {
      const args = TaskArgs.cancelUnclaimed.parse(raw);
      const scope = scopeOf(ctx);
      const service = await payoutsServiceFor(deps, scope);
      let outcome: Awaited<ReturnType<typeof service.cancelUnclaimed>>;
      try {
        outcome = await service.cancelUnclaimed(args.payoutItemId, ACTORS.outbox, args.afterCancel);
      } catch (e) {
        if (e instanceof PayoutsApiError) {
          if (e.status === 429) {
            throw new PayPalStepError("CIRCUIT_OPEN", "PayPal's sandbox is pacing us; the cancel waits.", {
              transient: true,
              retryAfterMs: 6 * 60_000,
              debugId: e.debugId,
              status: 429,
            });
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
    }),
  };
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
