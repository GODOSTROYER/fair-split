// The invoice presses outside Judge Mode's first press (S3.6.3): start invoicing a run (DRAFT → QUOTED, the
// code-built invoice created, sent and ruled through the ensureInvoice task), the treasurer's approval of the
// send (sendNeedsTreasurer), and "Check with PayPal" (a fresh funding GET, at most one per 10 s). Every one
// writes its task in the transaction that records the press (I7) and runs it inline.
import { InvoiceStatus, PayRunState, RunSlug, TASKS } from "@fairsplit/contracts";
import { schema, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { like, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActingCredential } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { allow, CAN } from "./access.js";
import { factLedger } from "./events.js";
import { invalidTransition, invoiceOfRun, lockRun, runById, runBySlug } from "./load.js";
import { enqueuePress, reportProblem, runNow } from "./now.js";

export const InvoicePressResponse = z.strictObject({
  runSlug: RunSlug,
  runState: PayRunState,
  invoiceNumber: z.string().nullable(),
  invoiceStatus: InvoiceStatus.nullable(),
  paypalInvoiceId: z.string().nullable(),
  /** The step's word when it stopped early ("PENDING_APPROVAL", "DENIED_BY_POLICY", "NOT_YET"). */
  outcome: z.string().nullable(),
  rail: z.enum(["simulated", "sandbox"]),
});
export type InvoicePressResponse = z.infer<typeof InvoicePressResponse>;

export const FUND_CHECK_RULE = { name: "fundCheck", limit: 1, windowMs: 10_000 } as const;

async function answer(
  deps: AppDeps,
  scope: WorkspaceScope,
  runId: string,
  outcome: string | null,
): Promise<InvoicePressResponse> {
  const run = await runById(deps.db, scope, runId);
  const inv = await invoiceOfRun(deps.db, scope, runId);
  return {
    runSlug: run.runSlug,
    runState: run.state as z.infer<typeof PayRunState>,
    invoiceNumber: inv?.invoiceNumber ?? null,
    invoiceStatus: inv && inv.status !== "NEW" ? (inv.status as z.infer<typeof InvoiceStatus>) : null,
    paypalInvoiceId: inv?.paypalInvoiceId ?? null,
    outcome,
    rail: deps.paypal.label,
  };
}

async function runAndAnswer(
  deps: AppDeps,
  scope: WorkspaceScope,
  runId: string,
  outboxId: string,
): Promise<InvoicePressResponse> {
  const r = await runNow(deps, outboxId);
  if (r && !r.ok) throw reportProblem(r);
  const outcome =
    r?.ok && typeof r.detail?.state === "string"
      ? r.detail.state
      : r?.ok && r.detail?.funded === false
        ? "NOT_YET"
        : null;
  return answer(deps, scope, runId, outcome);
}

/** POST /v1/runs/:runSlug/invoice: quote and invoice a DRAFT or QUOTED run. */
export async function startInvoicing(
  deps: AppDeps,
  scope: WorkspaceScope,
  credential: ActingCredential,
  runSlug: string,
  at: Date,
) {
  allow(credential, CAN.markPaid, "Invoicing the brand");
  const found = await runBySlug(deps.db, scope, runSlug);
  const outboxId = await withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, found.id);
    if (run.state !== "DRAFT" && run.state !== "QUOTED") {
      throw invalidTransition(
        run.state as z.infer<typeof PayRunState>,
        `The run is ${run.state}; it was already invoiced.`,
      );
    }
    await factLedger(tx, scope, "invoice.requested", { runId: run.id }, { runId: run.id, at });
    const args = { target: "SENT" as const, runId: run.id };
    return enqueuePress(tx, "ensureInvoice", args, TASKS.ensureInvoice.dedupeKey(args), {
      workspaceId: scope.workspaceId,
    });
  });
  return runAndAnswer(deps, scope, found.id, outboxId);
}

/** POST /v1/runs/:runSlug/invoice/approve-send: the treasurer approves sending this run's invoice. */
export async function approveSend(
  deps: AppDeps,
  scope: WorkspaceScope,
  credential: ActingCredential,
  runSlug: string,
  at: Date,
) {
  allow(credential, CAN.markPaid, "Approving the invoice send");
  if (credential.role !== "treasurer" && credential.role !== "judge")
    throw problem.forbidden("Only the treasurer approves the send.");
  const found = await runBySlug(deps.db, scope, runSlug);
  const outboxId = await withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, found.id);
    if (run.state !== "QUOTED")
      throw invalidTransition(
        run.state as z.infer<typeof PayRunState>,
        `The run is ${run.state}; there is no invoice waiting to be sent.`,
      );
    const inv = await invoiceOfRun(tx, scope, run.id);
    await factLedger(
      tx,
      scope,
      "invoice.send_approved",
      { runId: run.id, invoiceNumber: inv?.invoiceNumber ?? null },
      { runId: run.id, at },
    );
    const args = { target: "SENT" as const, runId: run.id };
    return enqueuePress(tx, "ensureInvoice", args, `${TASKS.ensureInvoice.dedupeKey(args)}:approved`, {
      workspaceId: scope.workspaceId,
    });
  });
  return runAndAnswer(deps, scope, found.id, outboxId);
}

/** POST /v1/runs/:runSlug/funding-check: "Check with PayPal", one fresh GET (at most one per 10 s). */
export async function fundingCheck(
  deps: AppDeps,
  scope: WorkspaceScope,
  credential: ActingCredential,
  runSlug: string,
) {
  allow(credential, CAN.markPaid, "Checking the invoice");
  const found = await runBySlug(deps.db, scope, runSlug);
  const taken = deps.rateLimits.take(FUND_CHECK_RULE, `${scope.workspaceId}:${found.id}`);
  if (!taken.ok)
    throw problem.rateLimited(taken.retryAfterMs, "Check with PayPal at most once every 10 seconds.");
  const outboxId = await withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, found.id);
    if (run.state !== "INVOICED")
      throw invalidTransition(
        run.state as z.infer<typeof PayRunState>,
        `The run is ${run.state}; only an invoiced run waits for funding.`,
      );
    const inv = await invoiceOfRun(tx, scope, run.id);
    if (!inv?.paypalInvoiceId)
      throw new ApiProblem("INVALID_TRANSITION", "The invoice is not at PayPal yet.");
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.taskOutbox)
      .where(like(schema.taskOutbox.dedupeKey, `fund:${inv.paypalInvoiceId}:%`));
    const args = { target: "FUNDED" as const, runId: run.id, invoiceId: inv.paypalInvoiceId, n: count + 1 };
    return enqueuePress(tx, "ensureInvoice", args, TASKS.ensureInvoice.dedupeKey(args), {
      workspaceId: scope.workspaceId,
    });
  });
  return runAndAnswer(deps, scope, found.id, outboxId);
}

export const EmptyBody = z.strictObject({});
