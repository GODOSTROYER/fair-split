// The AgentMoneyPort over @fairsplit/paypal-toolkit and @fairsplit/paypal-payouts. Every invoice call:
//
//   1. builds the exact body PayPal will see from the database, IC-02 `canonicalInvoiceCall(method, expected,
//      labels).args`: the agent's input contributes at most the three item labels (I1), each from its line's
//      closed vocabulary (`ITEM_LABEL_WORDS`, see `itemLabelGuide` in ./port.ts);
//   2. decides THOSE arguments with the policy lattice (flags read fresh, the session's budget and iteration),
//      recording the verdict as a `policy.verdict` event and ledger entry with the agent as actor. Whatever the
//      model asked that code would not build (its own draft, refused labels, another invoice) is decided as
//      asked and recorded, and nothing is sent (money/policy.ts `decideInvoiceCall`);
//   3. on ALLOW (or REQUIRE_APPROVAL with the treasurer's approval) sends exactly those arguments through `tk()`,
//      never the model's, checkpointing in `invoices` like the ensureInvoice task, so the two paths can hand over.
// Payout reads use the typed Payouts tool's GETs; nothing here can create or cancel a payout.
import type { Decision, ToolCall } from "@fairsplit/contracts";
import { type Actor, schema, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import { autoCancelDate, autoCancelRuleArgs, canonicalSend } from "@fairsplit/domain";
import { getPayoutBatch, getPayoutItem } from "@fairsplit/paypal-payouts";
import { and, desc, eq } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { classifyPayPal } from "../money/errors.js";
import type { SendApproval } from "../money/funding.js";
import { addAutoCancelRule, createOrAdopt, getInvoice, sendInvoice } from "../money/invoices.js";
import { itemStatusOf } from "../money/items.js";
import {
  decideAndRecord,
  decideInvoiceCall,
  type InvoiceMethod,
  type InvoiceWorld,
  invoiceWorld,
  policyContext,
  todayOf,
} from "../money/policy.js";
import { toolkitFor } from "../money/toolkit.js";
import { factLedger } from "../runs/events.js";
import { lockRun, runById } from "../runs/load.js";
import {
  type AgentMoneyPort,
  type AgentSession,
  type ItemLabels,
  itemLabelGuide,
  type PortResult,
} from "./port.js";

type Deps = Pick<AppDeps, "db" | "env" | "paypal" | "clock" | "logger">;

export interface ExecutorOptions {
  session: AgentSession;
  /** The treasurer's approval of the send (Judge Mode: the session start, labelled). */
  sendApproval: SendApproval | null;
}

export function agentActor(session: AgentSession): Actor {
  return {
    kind: "agent",
    id: `agent:${session.purpose.toLowerCase()}:${session.sessionId}`,
    impersonatedBy: null,
  };
}

export function createAgentMoneyPort(deps: Deps, scope: WorkspaceScope, o: ExecutorOptions): AgentMoneyPort {
  const actor = agentActor(o.session);
  const provenance = o.session.mode === "replay" ? ("replay" as const) : deps.paypal.provenance;
  const tk = toolkitFor(deps, { workspaceId: scope.workspaceId });
  let iteration = o.session.iteration;

  const budget = () => ({
    spentMicros: o.session.spentMicros,
    capMicros: o.session.capMicros,
    iteration,
    maxIterations: o.session.maxIterations,
  });
  const record = (runId: string) => ({
    runId,
    sessionId: o.session.sessionId,
    actor,
    at: deps.clock.now(),
    provenance,
  });

  /** Decide (and record) a read or a request: the call as code builds it. */
  const gate = async (runId: string, call: (w: InvoiceWorld) => ToolCall) =>
    withWorkspaceTx(deps.db, scope, async (tx) => {
      const run = await lockRun(tx, scope, runId);
      const w = await invoiceWorld(tx, scope, deps, run);
      const ctx = await policyContext(tx, scope, deps, w, {
        today: todayOf(deps.clock.now()),
        budget: budget(),
      });
      const decision = await decideAndRecord(tx, scope, call(w), ctx, record(runId));
      iteration += 1;
      return { w, decision };
    });

  /** An invoice call: `canonicalInvoiceCall`'s args, decided and recorded; the args to send, or null. */
  const invoiceGate = async <M extends InvoiceMethod>(
    runId: string,
    c: { method: M; labels?: ItemLabels; invoiceDate?: string | null; asked?: unknown },
  ) =>
    withWorkspaceTx(deps.db, scope, async (tx) => {
      const run = await lockRun(tx, scope, runId);
      const w = await invoiceWorld(tx, scope, deps, run);
      const decided = await decideInvoiceCall(tx, scope, deps, w, {
        ...c,
        today: todayOf(deps.clock.now()),
        budget: budget(),
        record: record(runId),
      });
      iteration += 1;
      return { w, ...decided };
    });

  const refused = <T>(
    d: Decision,
    error: "POLICY_DENIED" | "APPROVAL_REQUIRED" = "POLICY_DENIED",
    why: string | null = null,
  ): PortResult<T> => ({
    ok: false,
    verdict: d.verdict,
    error,
    reason:
      [
        ...d.results.filter((r) => r.reason && r.verdict !== "ALLOW").map((r) => `${r.policy}: ${r.reason}`),
        ...(why ? [why] : []),
      ].join("; ") || d.verdict,
    decidedBy: d.decidedBy,
  });

  const failed = <T>(d: Decision, e: unknown, what: string): PortResult<T> => {
    const step = classifyPayPal(e, what);
    return {
      ok: false,
      verdict: d.verdict,
      error: step.code === "PAYPAL_REJECTED" ? "PAYPAL_REJECTED" : "PAYPAL_UNAVAILABLE",
      reason: step.message,
      decidedBy: d.decidedBy,
    };
  };

  return {
    async createRunInvoice(req) {
      // Code builds the body from the run and the agent's three labels; a supplied draft (the tamper demo, a
      // hostile eval) is decided as given unless it is exactly that body, and is never sent.
      const { w, decision, args, reason } = await invoiceGate(req.runId, {
        method: "create_invoice",
        labels: req.itemLabels,
        ...(req.draft === undefined ? {} : { asked: req.draft }),
      });
      if (decision.verdict === "DENY" || !args) {
        // Labels core refused: the answer carries each line's closed vocabulary, to label again from.
        const labelled =
          !args && req.draft === undefined && reason ? `${reason}\n${itemLabelGuide()}` : reason;
        return refused(decision, "POLICY_DENIED", labelled);
      }
      try {
        const out = await createOrAdopt(tk, w, args);
        await withWorkspaceTx(deps.db, scope, async (tx) => {
          await tx
            .update(schema.invoices)
            .set({ paypalInvoiceId: out.invoiceId, status: "DRAFT", provenance: deps.paypal.provenance })
            .where(
              and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, req.runId)),
            );
        });
        return {
          ok: true,
          verdict: decision.verdict,
          value: { invoiceId: out.invoiceId, adopted: out.adopted },
        };
      } catch (e) {
        return failed(decision, e, "creating the invoice");
      }
    },

    async sendRunInvoice(req) {
      // Only this run's own invoice is ever sent: another id is decided as asked, refused, and never sent.
      const { decision, args, reason } = await invoiceGate(req.runId, {
        method: "send_invoice",
        asked: canonicalSend(req.invoiceId),
      });
      if (decision.verdict === "DENY" || !args) return refused(decision, "POLICY_DENIED", reason);
      if (!o.sendApproval) return refused(decision, "APPROVAL_REQUIRED");
      try {
        const sent = await sendInvoice(tk, args);
        const got = await getInvoice(tk, req.invoiceId);
        await withWorkspaceTx(deps.db, scope, async (tx) => {
          await tx
            .update(schema.invoices)
            .set({
              sentAt: deps.clock.now(),
              payerViewUrl: sent.payerViewUrl ?? got.payerViewUrl,
              ...(got.invoiceDate ? { createdAtPaypal: new Date(`${got.invoiceDate}T00:00:00.000Z`) } : {}),
              ...(got.status ? { status: got.status } : {}),
            })
            .where(
              and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, req.runId)),
            );
          await factLedger(
            tx,
            scope,
            "invoice.sent",
            { runId: req.runId, invoiceId: req.invoiceId, approvedBy: o.sendApproval?.approverId ?? null },
            { runId: req.runId, at: deps.clock.now(), actor },
          );
        });
        return { ok: true, verdict: decision.verdict, value: { sent: true } };
      } catch (e) {
        return failed(decision, e, "sending the invoice");
      }
    },

    async addAutoCancelRule(req) {
      // The rule's date comes from PayPal's invoice date, read back by a GET; never from the agent. Only this
      // run's own invoice (the database's id) is ever read or written: an id the agent made up goes straight to
      // the lattice below (a recorded DENY) and touches nothing.
      let invoiceDate: string | null = null;
      const current = await withWorkspaceTx(deps.db, scope, async (tx) =>
        invoiceWorld(tx, scope, deps, await runById(tx, scope, req.runId)),
      );
      const ours = current.expected.invoiceId;
      invoiceDate = current.expected.invoiceDate;
      if (!invoiceDate && ours !== null && req.invoiceId === ours) {
        try {
          const got = await getInvoice(tk, ours);
          invoiceDate = got.invoiceDate;
          if (invoiceDate) {
            await deps.db
              .update(schema.invoices)
              .set({ createdAtPaypal: new Date(`${invoiceDate}T00:00:00.000Z`) })
              .where(
                and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, req.runId)),
              );
          }
        } catch {
          // decided below without a date: dueWithin30Days denies it
        }
      }
      const date = invoiceDate;
      const { decision, args, reason } = await invoiceGate(req.runId, {
        method: "create_conditional_rules_for_invoice",
        invoiceDate: date,
        asked: date
          ? autoCancelRuleArgs(req.invoiceId, autoCancelDate(date))
          : { invoice_id: req.invoiceId, rules: [] },
      });
      if (decision.verdict === "DENY" || !args) return refused(decision, "POLICY_DENIED", reason);
      try {
        const on = await addAutoCancelRule(tk, args);
        await deps.db
          .update(schema.invoices)
          .set({ ruleCreatedAt: deps.clock.now(), autoCancelOn: on })
          .where(
            and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, req.runId)),
          );
        return { ok: true, verdict: decision.verdict, value: { autoCancelOn: on } };
      } catch (e) {
        return failed(decision, e, "the auto-cancel rule");
      }
    },

    async getInvoice(req) {
      const { w, decision } = await gate(req.runId, (x) => ({
        name: "get_invoice",
        args: { invoice_id: x.expected.invoiceId ?? "" },
      }));
      if (decision.verdict === "DENY" || !w.expected.invoiceId) return refused(decision);
      try {
        const s = await getInvoice(tk, w.expected.invoiceId);
        return {
          ok: true,
          verdict: decision.verdict,
          value: {
            invoiceId: s.invoiceId,
            invoiceNumber: s.invoiceNumber,
            status: s.status,
            totalCents: s.totalCents,
            dueCents: s.dueCents,
            invoiceDate: s.invoiceDate,
          },
        };
      } catch (e) {
        return failed(decision, e, "reading the invoice");
      }
    },

    async getPayoutBatch(req) {
      const [batch] = await deps.db
        .select()
        .from(schema.payoutBatches)
        .where(
          and(
            eq(schema.payoutBatches.workspaceId, scope.workspaceId),
            eq(schema.payoutBatches.runId, req.runId),
          ),
        )
        .orderBy(desc(schema.payoutBatches.createdAt))
        .limit(1);
      const { decision } = await gate(req.runId, () => ({
        name: "get_payout_batch",
        args: { payout_batch_id: batch?.paypalBatchId ?? "" },
      }));
      if (decision.verdict === "DENY" || !batch?.paypalBatchId) return refused(decision);
      const got = await getPayoutBatch(
        deps.paypal.core.http,
        { sandbox: true },
        { payout_batch_id: batch.paypalBatchId, page: 1, page_size: 100, total_required: true },
        { priority: "background" },
      );
      if (!got.ok) return failed(decision, new Error(got.name), "reading the payout batch");
      return {
        ok: true,
        verdict: decision.verdict,
        value: {
          payoutBatchId: batch.paypalBatchId,
          batchStatus: got.body.batch_header?.batch_status ?? null,
          items: (got.body.items ?? []).map((i) => ({
            senderItemId: i.payout_item?.sender_item_id ?? "",
            status: itemStatusOf(i.transaction_status),
          })),
        },
      };
    },

    async getPayoutItem(req) {
      const { decision } = await gate(req.runId, () => ({
        name: "get_payout_item",
        args: { payout_item_id: req.payoutItemId },
      }));
      if (decision.verdict === "DENY") return refused(decision);
      // Only an item of this run's batches may be read.
      const [mine] = await deps.db
        .select({ id: schema.payoutItems.id })
        .from(schema.payoutItems)
        .innerJoin(schema.payoutBatches, eq(schema.payoutBatches.id, schema.payoutItems.batchId))
        .where(
          and(
            eq(schema.payoutItems.workspaceId, scope.workspaceId),
            eq(schema.payoutBatches.runId, req.runId),
            eq(schema.payoutItems.payoutItemId, req.payoutItemId),
          ),
        );
      if (!mine) return refused(decision);
      const got = await getPayoutItem(
        deps.paypal.core.http,
        { sandbox: true },
        { payout_item_id: req.payoutItemId },
        { priority: "background" },
      );
      if (!got.ok) return failed(decision, new Error(got.name), "reading the payout item");
      return {
        ok: true,
        verdict: decision.verdict,
        value: { status: itemStatusOf(got.body.transaction_status) },
      };
    },

    async requestPayoutBatch(req) {
      const { decision } = await gate(req.runId, () => ({
        name: "request_payout_batch",
        args: { run_id: req.runId },
      }));
      if (decision.verdict === "DENY") return refused(decision);
      await withWorkspaceTx(deps.db, scope, (tx) =>
        factLedger(
          tx,
          scope,
          "batch.requested",
          { runId: req.runId, sessionId: o.session.sessionId },
          { runId: req.runId, at: deps.clock.now(), actor },
        ),
      );
      return { ok: true, verdict: decision.verdict, value: { opened: true } };
    },
  };
}
