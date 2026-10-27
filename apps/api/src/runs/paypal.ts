// The person-pressed PayPal steps (IC-01): `markPaid` (Judge Mode funding on the simulated rail, MM-S) and
// `payCash` (Rhea's parked item moved to the bodega, MM-6), plus the P1 re-route (`resend`). Each writes its
// outbox task in the transaction that checks the state (I7) and runs it inline (runs/now.ts) so the answer says
// what PayPal said; nothing here calls PayPal inside a transaction.
import { type MemberLineState, type PayRunState, TASKS } from "@fairsplit/contracts";
import { schema, withWorkspaceTx } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { and, desc, eq } from "drizzle-orm";
import type { CommandHandler } from "../lib/command.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { advanceRun } from "../money/settle.js";
import { allow, CAN } from "./access.js";
import { lineDto } from "./dto.js";
import { factLedger } from "./events.js";
import { assertNotKilled } from "./flags.js";
import { casGuard, invalidTransition, invoiceOfRun, lockRun, runById, runBySlug } from "./load.js";
import { cause, moveLine } from "./machine.js";
import { reportProblem, runNow } from "./now.js";

// ---------------------------------------------------------------- markPaid

export const markPaidHandler: CommandHandler<"markPaid"> = async (ctx) => {
  allow(ctx.credential, CAN.markPaid, "Marking the invoice paid");
  const { deps, scope } = ctx;
  const at = ctx.now();
  const found = await runBySlug(deps.db, scope, ctx.params.runSlug);
  const outboxId = await withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, found.id);
    if (run.state !== "INVOICED") {
      throw invalidTransition(
        run.state as PayRunState,
        `The run is ${run.state}; only an invoiced run can be marked paid.`,
      );
    }
    await assertNotKilled(deps, scope.workspaceId, "kill_paypal_live", tx);
    const invoice = await invoiceOfRun(tx, scope, run.id);
    if (!invoice?.paypalInvoiceId || !invoice.sentAt) {
      throw invalidTransition(run.state as PayRunState, "The invoice has not been sent yet.");
    }
    await factLedger(
      tx,
      scope,
      "invoice.mark_paid_requested",
      { runId: run.id, invoiceNumber: invoice.invoiceNumber },
      { runId: run.id, at },
    );
    const args = { runId: run.id, invoiceId: invoice.paypalInvoiceId };
    return (
      await enqueue(tx, "recordPayment", args, TASKS.recordPayment.dedupeKey(args), {
        workspaceId: scope.workspaceId,
      })
    ).id;
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

const CASH_DUE_FROM_RUN: readonly PayRunState[] = [
  "APPROVED",
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
          const queued = await enqueue(tx, "cancelUnclaimed", args, TASKS.cancelUnclaimed.dedupeKey(args), {
            workspaceId: scope.workspaceId,
          });
          return { kind: "cancel", outboxId: queued.id };
        }
        const cashReady =
          state === "READY" && line.rail === "OFF" && CASH_DUE_FROM_RUN.includes(run.state as PayRunState);
        if (state === "RETURNED" || cashReady) {
          if (state === "RETURNED") {
            const [item] = await tx
              .select({ cancelIntent: schema.payoutItems.cancelIntent })
              .from(schema.payoutItems)
              .where(
                and(
                  eq(schema.payoutItems.workspaceId, scope.workspaceId),
                  eq(schema.payoutItems.lineId, line.id),
                  eq(schema.payoutItems.status, "RETURNED"),
                ),
              )
              .limit(1);
            if (item?.cancelIntent === "reroute") {
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
          `A ${state} line cannot move to cash${line.rail === "OFF" && state === "READY" ? " before the run is approved" : ""}.`,
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
