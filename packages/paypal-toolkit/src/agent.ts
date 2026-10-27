// The agent's door to PayPal. WS-AGENT's tool runner calls this after the policy lattice
// (`decide`) and the ledger; it enforces the register §8 contract again at the execution edge.
// Every call is bound to ONE run and goes through that run's checkpointed invoice chain
// (Invoices), never through raw tk(), so the agent and the deterministic path share one
// idempotency key (FS-{runSlug}), one adoption rule and one checkpoint:
//   - create_invoice creates (or adopts) the run's invoice only if the draft equals the code-built
//     invoice but for the three item labels, the agent's only words (I1); a run that already holds
//     its invoice is not created again.
//   - send_invoice sends only this run's invoice, never e-mailed, and only with the treasurer's
//     approval bound to that very invoice (its PayPal id and sendArgsSha256 of the exact send);
//     without one it parks as PENDING_APPROVAL. The payable GET follows; a SCHEDULED invoice is left
//     for the server chain, which recreates it once.
//   - create_conditional_rules_for_invoice is AUTO_CANCEL on a SPECIFIC_DATE equal to PayPal's
//     invoice date + 25 days (C-27), after today and within 30 days, under request id cr-{invoiceId}.
//   - get_invoice reads this run's invoice only.
// Nothing refused is sent, and nothing here moves money or deletes anything.

import type { CallPriority } from "@fairsplit/paypal-core";
import { type AgentToolMethod, isAgentToolMethod } from "./actions.js";
import {
  approvalCovers,
  type InvoiceRun,
  reconcileAgentDraft,
  type TreasurerApproval,
} from "./invoice-plan.js";
import {
  InvoiceApprovalError,
  type InvoiceCheckpoint,
  InvoiceDraftRejectedError,
  InvoiceRuleDateError,
  InvoiceStateError,
  type Invoices,
} from "./invoices.js";
import { toolkitZodSchemas } from "./schemas.js";

export { conditionalRuleRequestId } from "./invoice-plan.js";

/** One agent session works on one run. */
export interface AgentInvoiceSession {
  run: InvoiceRun;
  /** The checkpointed chain: the agent's create, send, rule and read go through it, never through raw tk(). */
  invoices: Invoices;
}

export interface AgentToolkitCallOptions {
  /** Present only once Analyn (or Judge-as-Treasurer, labelled) approved sending this invoice. */
  treasurerApproval?: TreasurerApproval | null;
  priority?: CallPriority;
}

export type AgentToolkitResult =
  | {
      status: "DONE";
      method: "create_invoice";
      invoiceId: string;
      invoiceNumber: string;
      adopted: boolean;
      alreadyDone: boolean;
    }
  | { status: "PENDING_APPROVAL"; method: "send_invoice"; invoiceId: string }
  | {
      status: "DONE";
      method: "send_invoice";
      invoiceId: string;
      payerViewUrl: string | null;
      alreadyDone: boolean;
    }
  | {
      status: "DONE";
      method: "create_conditional_rules_for_invoice";
      invoiceId: string;
      autoCancelOn: string;
      alreadyDone: boolean;
    }
  | { status: "DONE"; method: "get_invoice"; invoiceId: string; result: unknown };

/** The model asked for a tool outside the agent allowlist. Nothing was sent. */
export class AgentToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`The agent may not call ${tool}`);
    this.name = "AgentToolNotAllowedError";
  }
}

/** The arguments break the register §8 contract for this tool. Nothing was sent. */
export class AgentToolRefusedError extends Error {
  constructor(
    readonly tool: AgentToolMethod,
    readonly reason: string,
    readonly mismatches: readonly string[] = [],
  ) {
    super(`${tool}: ${reason}`);
    this.name = "AgentToolRefusedError";
  }
}

function parseAgentArgs(tool: AgentToolMethod, args: unknown): Record<string, unknown> {
  const parsed = toolkitZodSchemas().get(tool)?.safeParse(args);
  if (!parsed?.success) throw new AgentToolRefusedError(tool, "arguments do not match the toolkit schema");
  return parsed.data as Record<string, unknown>;
}

/** The run's invoice id, refusing a call about any other invoice (or before one exists). */
function boundInvoiceId(tool: AgentToolMethod, cp: InvoiceCheckpoint, requested: unknown): string {
  if (!cp.invoiceId) throw new AgentToolRefusedError(tool, "this run has no invoice yet");
  if (requested !== cp.invoiceId)
    throw new AgentToolRefusedError(tool, "invoice_id is not this run's invoice");
  return cp.invoiceId;
}

/** Exactly one AUTO_CANCEL on a SPECIFIC_DATE, with no discount value; returns its end date. */
function autoCancelEndDate(args: Record<string, unknown>): string {
  const tool = "create_conditional_rules_for_invoice";
  const rules = args.rules;
  if (!Array.isArray(rules) || rules.length !== 1)
    throw new AgentToolRefusedError(tool, "exactly one AUTO_CANCEL rule");
  const rule = rules[0] as Record<string, unknown>;
  const terms = rule.rule_expiry_terms as Record<string, unknown> | undefined;
  if (
    rule.conditional_rule_type !== "AUTO_CANCEL" ||
    rule.conditional_rule_value !== undefined ||
    rule.conditional_rule_value_type !== undefined ||
    terms?.rule_expiry_condition !== "SPECIFIC_DATE" ||
    typeof terms.condition_rule_end_date !== "string"
  ) {
    throw new AgentToolRefusedError(tool, "only AUTO_CANCEL on a SPECIFIC_DATE, with no discount value");
  }
  return terms.condition_rule_end_date;
}

/** The chain refused a step before calling PayPal: report it to the model as a refusal. */
function asRefusal(tool: AgentToolMethod) {
  return (error: unknown): never => {
    if (error instanceof InvoiceDraftRejectedError) {
      throw new AgentToolRefusedError(
        tool,
        "the draft differs from the code-built invoice",
        error.mismatches,
      );
    }
    if (
      error instanceof InvoiceApprovalError ||
      error instanceof InvoiceStateError ||
      error instanceof InvoiceRuleDateError
    ) {
      throw new AgentToolRefusedError(tool, error.message);
    }
    throw error;
  };
}

/** Runs one agent tool call for the session's run through the checkpointed chain, or refuses it. */
export async function runAgentToolkitTool(
  session: AgentInvoiceSession,
  tool: string,
  args: unknown,
  options: AgentToolkitCallOptions = {},
): Promise<AgentToolkitResult> {
  if (!isAgentToolMethod(tool)) throw new AgentToolNotAllowedError(tool);
  const data = parseAgentArgs(tool, args);
  const { run, invoices } = session;
  const cp = await invoices.checkpoint(run.runId);
  const callOptions = { priority: options.priority };

  switch (tool) {
    case "create_invoice": {
      // Checked here too, against the draft as the model wrote it, so a refused draft never reaches the chain (I1).
      const reconciled = reconcileAgentDraft(args, await invoices.plan(run));
      if (!reconciled.ok) {
        throw new AgentToolRefusedError(
          tool,
          "the draft differs from the code-built invoice",
          reconciled.mismatches,
        );
      }
      const created = await invoices.create(run, { draft: args, ...callOptions }).catch(asRefusal(tool));
      return {
        status: "DONE",
        method: tool,
        invoiceId: created.invoiceId,
        invoiceNumber: created.invoiceNumber,
        adopted: created.adopted,
        alreadyDone: created.alreadyDone,
      };
    }
    case "send_invoice": {
      const invoiceId = boundInvoiceId(tool, cp, data.invoice_id);
      const extra = data.additional_recipients;
      if (Array.isArray(extra) && extra.length > 0) {
        throw new AgentToolRefusedError(tool, "additional recipients are not allowed");
      }
      // Register §8: always send_to_recipient false; the code sends no note (no agent text reaches PayPal).
      if (cp.sentAt && cp.payableAt) {
        return { status: "DONE", method: tool, invoiceId, payerViewUrl: cp.payerViewUrl, alreadyDone: true };
      }
      const approval = options.treasurerApproval ?? null;
      if (!cp.sentAt) {
        if (!approval) return { status: "PENDING_APPROVAL", method: tool, invoiceId };
        // Bound to the target: the approval names this invoice's PayPal id and the hash of the exact
        // send (sendArgsSha256), so an approval of another invoice, or of a send with other
        // arguments, sends nothing.
        const { invoiceNumber } = await invoices.plan(run);
        if (!approvalCovers(approval, { invoiceNumber, invoiceId }, { bound: true })) {
          throw new AgentToolRefusedError(
            tool,
            "the treasurer's approval is not bound to this invoice and this send",
          );
        }
      }
      const sent = await invoices.send(run, approval, callOptions).catch(asRefusal(tool));
      return {
        status: "DONE",
        method: tool,
        invoiceId,
        payerViewUrl: sent.payerViewUrl,
        alreadyDone: sent.alreadyDone,
      };
    }
    case "create_conditional_rules_for_invoice": {
      const invoiceId = boundInvoiceId(tool, cp, data.invoice_id);
      const endDate = autoCancelEndDate(data);
      // Invoices refuses, before the rule call, a date other than PayPal's invoice date + 25 days, and
      // one that is not after today or is over 30 days out.
      const rule = await invoices.ensureRule(run, { ...callOptions, endDate }).catch(asRefusal(tool));
      return {
        status: "DONE",
        method: tool,
        invoiceId,
        autoCancelOn: rule.autoCancelOn,
        alreadyDone: rule.alreadyDone,
      };
    }
    case "get_invoice": {
      const invoiceId = boundInvoiceId(tool, cp, data.invoice_id);
      const result = await invoices.fetch(run, callOptions).catch(asRefusal(tool));
      return { status: "DONE", method: tool, invoiceId, result };
    }
  }
}
