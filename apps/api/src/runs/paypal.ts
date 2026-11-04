// The person-pressed PayPal steps (IC-01): `markPaid` (Judge Mode funding on the simulated rail, MM-S; refused
// in a real or showcase workspace on the sandbox rail, where the brand pays the hosted page) and
// `payCash` (Rhea's parked item moved to the bodega, MM-6), plus the P1 re-route (`resend`). Each writes its
// outbox task in the transaction that checks the state (I7) and runs it inline (runs/now.ts) so the answer says
// what PayPal said; nothing here calls PayPal inside a transaction.
import { type MemberLineState, type PayRunState, TASKS } from "@fairsplit/contracts";
import { schema, type Tx, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { CommandHandler } from "../lib/command.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { advanceRun } from "../money/settle.js";
import { allow, CAN } from "./access.js";
import { lineDto } from "./dto.js";
import { factLedger } from "./events.js";
import { assertNotKilled } from "./flags.js";
import { casGuard, invalidTransition, invoiceOfRun, lockRun, runById, runBySlug } from "./load.js";
import { cause, moveLine } from "./machine.js";
import { enqueuePress, outboxRetryAfterMs, reportProblem, runNow } from "./now.js";

// ---------------------------------------------------------------- markPaid

export const markPaidHandler: CommandHandler<"markPaid"> = async (ctx) => {
  allow(ctx.credential, CAN.markPaid, "Marking the invoice paid");
  const { deps, scope } = ctx;
  const at = ctx.now();
  const found = await runBySlug(deps.db, scope, ctx.params.runSlug);
  // S3.6.3: "Mark paid" is Judge Mode's funding (or anything on the simulated rail). On the sandbox rail a real
  // or showcase run is funded by the brand paying PayPal's hosted page, never by the treasurer's press alone.
  const [workspace] = await deps.db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, scope.workspaceId));
  if (workspace?.kind !== "judge" && deps.paypal.mode !== "simulator") {
    throw invalidTransition(
      found.state as PayRunState,
      "Mark paid is Judge Mode's simulated funding; this run is funded when the brand pays the invoice on PayPal.",
    );
  }
  const outboxId = await withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, found.id);
    if (run.state !== "INVOICED") {
      throw invalidTransition(
        run.state as PayRunState,
        `The run is ${run.state}; only an invoiced run can be marked paid.`,
      );
    }
    // S3.11: kill_paypal_live refuses outside Judge Mode; in it the funding step is a labelled replay instead
    // (the recordPayment task asks money/rail.ts before any PayPal call).
    if (workspace?.kind !== "judge") await assertNotKilled(deps, scope.workspaceId, "kill_paypal_live", tx);
    const invoice = await invoiceOfRun(tx, scope, run.id);
    if (!invoice?.paypalInvoiceId || !invoice.sentAt) {
      throw invalidTransition(run.state as PayRunState, "The invoice has not been sent yet.");
    }
    // A re-press only observes an unfinished payment; it must not dispatch it again or add another intent.
    // Keep this after the state guard: funding that already moved the run forward still refuses a press.
    const t = schema.taskOutbox;
    const [pending] = await tx
      .select({ id: t.id, state: t.state, runAfter: t.runAfter })
      .from(t)
      .where(
        and(
          eq(t.workspaceId, scope.workspaceId),
          eq(t.name, "recordPayment"),
          inArray(t.state, ["queued", "dispatched", "running"]),
          sql`${t.args}->>'runId' = ${run.id}`,
        ),
      )
      .limit(1);
    if (pending)
      throw new ApiProblem("QUEUED", "The PayPal step is queued and will be retried shortly.", {
        retryAfterMs: outboxRetryAfterMs(pending.runAfter),
      });
    await factLedger(
      tx,
      scope,
      "invoice.mark_paid_requested",
      { runId: run.id, invoiceNumber: invoice.invoiceNumber },
      { runId: run.id, at },
    );
    const args = { runId: run.id, invoiceId: invoice.paypalInvoiceId };
    return enqueuePress(tx, "recordPayment", args, TASKS.recordPayment.dedupeKey(args), {
      workspaceId: scope.workspaceId,
    });
  });
  const report = await runNow(deps, outboxId);
  if (report && !report.ok) throw reportProblem(report);
  const run = await runById(deps.db, scope, found.id);
  const invoice = await invoiceOfRun(deps.db, scope, run.id);
  if (!invoice?.paypalInvoiceId) throw problem.internal("The invoice disappeared.");
  return {
    runSlug: run.runSlug,
    invoiceId: invoice.paypalInvoiceId,
    invoiceStatus: invoice.status === "NEW" ? "DRAFT" : invoice.status,
    runState: run.state as PayRunState,
    provenance: "simulated_rail",
  };
};

// ---------------------------------------------------------------- payCash

/**
 * Whether a re-route of this returned item can still pay the member: rows were written for it (an item superseding
 * it), or a reroute task of the line is queued, dispatched or running. Read inside the caller's transaction.
 */
export async function rerouteStillPending(
  tx: Tx,
  scope: WorkspaceScope,
  lineId: string,
  itemId: string,
): Promise<boolean> {
  const [written] = await tx
    .select({ id: schema.payoutItems.id })
    .from(schema.payoutItems)
    .where(
      and(
        eq(schema.payoutItems.workspaceId, scope.workspaceId),
        eq(schema.payoutItems.supersedesItemId, itemId),
      ),
    )
    .limit(1);
  if (written) return true;
  const t = schema.taskOutbox;
  const [waiting] = await tx
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, scope.workspaceId),
        eq(t.name, "reroute"),
        inArray(t.state, ["queued", "dispatched", "running"]),
        sql`${t.args}->>'lineId' = ${lineId}`,
      ),
    )
    .limit(1);
  return waiting !== undefined;
}

const CASH_DUE_FROM_RUN: readonly PayRunState[] = [
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
];

export const payCashHandler: CommandHandler<"payCash"> = async (ctx) => {
  allow(ctx.credential, CAN.payCash, "Paying in cash");
  const { deps, scope } = ctx;
  const at = ctx.now();
  type Plan = { kind: "cancel"; outboxId: string } | { kind: "done" };
  const plan: Plan = await casGuard(
    () =>
      withWorkspaceTx(deps.db, scope, async (tx): Promise<Plan> => {
        const [found] = await tx
          .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
          .from(schema.memberLines)
          .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
          .where(
            and(
              eq(schema.memberLines.workspaceId, scope.workspaceId),
              eq(schema.memberLines.id, ctx.params.lineId),
            ),
          )
          .for("update");
        if (!found) throw problem.notFound("No such line in this workspace.");
        const { line, memberNo } = found;
        const run = await lockRun(tx, scope, line.runId);
        const state = line.state as MemberLineState;
        if (state === "OFF_RAIL_DUE" || state === "OFF_RAIL_PAID") return { kind: "done" };
        if (state === "UNCLAIMED") {
          // "Posted batches keep settling, but cancel and re-route are refused" (S3.11).
          await assertNotKilled(deps, scope.workspaceId, "kill_payouts", tx);
          const [item] = await tx
            .select()
            .from(schema.payoutItems)
            .where(
              and(
                eq(schema.payoutItems.workspaceId, scope.workspaceId),
                eq(schema.payoutItems.lineId, line.id),
                eq(schema.payoutItems.status, "UNCLAIMED"),
              ),
            )
            .orderBy(desc(schema.payoutItems.createdAt))
            .limit(1);
          if (!item?.payoutItemId)
            throw invalidTransition(
              run.state as PayRunState,
              "PayPal has not named this item yet; wait for its status.",
            );
          if (item.cancelIntent === "reroute") {
            throw new ApiProblem("INVALID_TRANSITION", "This item is being re-routed, not moved to cash.", {
              details: { lineState: state },
            });
          }
          await factLedger(
            tx,
            scope,
            "line.cash_requested",
            { runId: run.id, lineId: line.id, memberNo },
            { runId: run.id, at },
          );
          const args = { payoutItemId: item.payoutItemId, afterCancel: "cash" as const };
          const outboxId = await enqueuePress(
            tx,
            "cancelUnclaimed",
            args,
            TASKS.cancelUnclaimed.dedupeKey(args),
            {
              workspaceId: scope.workspaceId,
            },
          );
          return { kind: "cancel", outboxId };
        }
        const cashReady =
          state === "READY" && line.rail === "OFF" && CASH_DUE_FROM_RUN.includes(run.state as PayRunState);
        if (state === "RETURNED" || cashReady) {
          if (state === "RETURNED") {
            const [item] = await tx
              .select({ id: schema.payoutItems.id, cancelIntent: schema.payoutItems.cancelIntent })
              .from(schema.payoutItems)
              .where(
                and(
                  eq(schema.payoutItems.workspaceId, scope.workspaceId),
                  eq(schema.payoutItems.lineId, line.id),
                  eq(schema.payoutItems.status, "RETURNED"),
                ),
              )
              .orderBy(desc(schema.payoutItems.createdAt))
              .limit(1);
            // Cancelled for a re-route: cash only once that re-route can no longer pay her. Under the workspace
            // lock and the line's row lock: no re-route rows were written for the item (a written one owns the
            // line), and no re-route task of the line is waiting to write them. A re-route refused or superseded
            // must never leave the member payable neither through PayPal nor in cash.
            if (
              item?.cancelIntent === "reroute" &&
              (await rerouteStillPending(tx, scope, line.id, item.id))
            ) {
              throw new ApiProblem(
                "INVALID_TRANSITION",
                "This returned item is being re-routed, not moved to cash.",
                { details: { lineState: state } },
              );
            }
          }
          await moveLine(tx, scope, {
            id: line.id,
            memberNo,
            runId: line.runId,
            from: state,
            to: "OFF_RAIL_DUE",
            version: line.version,
            cause: cause("MOVED_TO_CASH"),
            provenance: "live",
          });
          await advanceRun(tx, scope, line.runId, "live");
          return { kind: "done" };
        }
        throw new ApiProblem(
          "INVALID_TRANSITION",
          `A ${state} line cannot move to cash${line.rail === "OFF" && state === "READY" ? " until the approved batch is posted" : ""}.`,
          {
            details: { lineState: state, runState: run.state },
          },
        );
      }),
    "INVALID_TRANSITION",
  );
  let cancelled = false;
  if (plan.kind === "cancel") {
    const report = await runNow(deps, plan.outboxId);
    if (report && !report.ok) {
      throw reportProblem({ ...report, code: report.code === "QUEUED" ? "CIRCUIT_OPEN" : report.code });
    }
    cancelled = true;
  }
  const [after] = await deps.db
    .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
    .from(schema.memberLines)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
    .where(
      and(
        eq(schema.memberLines.workspaceId, scope.workspaceId),
        eq(schema.memberLines.id, ctx.params.lineId),
      ),
    );
  if (!after) throw problem.notFound("No such line in this workspace.");
  return { line: lineDto(after.line, after.memberNo), cancelled };
};
