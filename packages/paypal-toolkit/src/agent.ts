// The agent's door to PayPal: the invoice executor. WS-AGENT's tool runner calls this after the
// policy lattice (`decide`) and the ledger; it enforces the register §8 contract again at the
// execution edge, and it NEVER forwards the model's arguments. Every body sent is WS-CORE's
// `canonicalInvoiceCall(method, expected, labels)`, built from the run and its checkpoint, and core's
// `decide()` runs again, with the session's policy, on exactly that body before it is sent. Every
// call is bound to ONE run and goes through that run's checkpointed invoice chain (Invoices), never
// through raw tk(), so the agent and the deterministic path share one idempotency key
// (FS-{runSlug}), one adoption rule and one checkpoint. What the model's arguments may be:
//   - create_invoice: S4.4's `{item_labels: {premium, bonus, disbursement}}` (with this run's run_id,
//     if any), or a toolkit draft that is, byte for byte, core's canonical body for the item names it
//     carries. The three labels are the agent's only words (I1), checked by core's closed per-line
//     vocabulary; a run that already holds its invoice is not created again.
//   - send_invoice: `{invoice_id}` of this run's invoice, or the canonical send exactly. It sends only
//     with the treasurer's approval bound to that very invoice (its PayPal id and sendArgsSha256 of
//     the exact send); without one it parks as PENDING_APPROVAL. The payable GET follows; a SCHEDULED
//     invoice is left for the server chain, which recreates it once.
//   - create_conditional_rules_for_invoice: `{invoice_id}`, or the canonical rule exactly: AUTO_CANCEL
//     on a SPECIFIC_DATE equal to PayPal's invoice date + 25 days (C-27), after today and within 30
//     days, under request id cr-{invoiceId}.
//   - get_invoice: `{invoice_id}` of this run's invoice only.
// Anything else is refused and nothing is sent. Nothing here moves money or deletes anything.

import { canonicalSend } from "@fairsplit/domain";
import type { CallPriority } from "@fairsplit/paypal-core";
import { type AgentToolMethod, isAgentToolMethod } from "./actions.js";
import {
  approvalCovers,
  draftDifferences,
  type InvoiceRun,
  readAgentCreate,
  type TreasurerApproval,
} from "./invoice-plan.js";
import {
  InvoiceApprovalError,
  type InvoiceCheckpoint,
  InvoiceDraftRejectedError,
  InvoiceStateError,
  type Invoices,
} from "./invoices.js";
import { type InvoicePolicy, InvoicePolicyDeniedError } from "./policy.js";

export { conditionalRuleRequestId } from "./invoice-plan.js";

/** One agent session works on one run. */
export interface AgentInvoiceSession {
  run: InvoiceRun;
  /** The checkpointed chain: the agent's create, send, rule and read go through it, never through raw tk(). */
  invoices: Invoices;
  /**
   * The agent turn's policy lattice (required): core's `decide()` runs on every body the chain is
   * about to send for the agent, exactly as sent.
   */
  policy: InvoicePolicy;
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

/** The arguments break the register §8 contract for this tool, or the lattice refused it. Nothing was sent. */
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

const NOT_CANONICAL = "the arguments are not the canonical body code builds";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** `{invoice_id}` and nothing else: S4.4's wrapper input for the send, the rule and the read. */
const namesOnlyTheInvoice = (args: Record<string, unknown>): boolean =>
  Object.keys(args).length === 1 && Object.hasOwn(args, "invoice_id");

/** The run's invoice id, refusing a call about any other invoice (or before one exists). */
function boundInvoiceId(tool: AgentToolMethod, cp: InvoiceCheckpoint, args: unknown): string {
  if (!cp.invoiceId) throw new AgentToolRefusedError(tool, "this run has no invoice yet");
  if (!isRecord(args) || args.invoice_id !== cp.invoiceId)
    throw new AgentToolRefusedError(tool, "invoice_id is not this run's invoice");
  return cp.invoiceId;
}

/** The chain refused a step before calling PayPal: report it to the model as a refusal. */
function asRefusal(tool: AgentToolMethod) {
  return (error: unknown): never => {
    if (error instanceof InvoiceDraftRejectedError) {
      throw new AgentToolRefusedError(tool, NOT_CANONICAL, error.mismatches);
    }
    if (error instanceof InvoicePolicyDeniedError) {
      throw new AgentToolRefusedError(
        tool,
        `the policy lattice answered ${error.decision.verdict}`,
        error.reasons,
      );
    }
    if (error instanceof InvoiceApprovalError || error instanceof InvoiceStateError) {
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
  const { run, invoices, policy } = session;
  if (!policy || typeof policy.env !== "function") {
    throw new TypeError("runAgentToolkitTool needs the agent turn's policy lattice (session.policy)");
  }
  const cp = await invoices.checkpoint(run.runId);
  const step = { policy, priority: options.priority };

  switch (tool) {
    case "create_invoice": {
      // Read here, against the model's arguments as written, so a refused draft never reaches the chain (I1).
      const read = readAgentCreate(args, await invoices.plan(run), run.runId);
      if (!read.ok) throw new AgentToolRefusedError(tool, NOT_CANONICAL, read.mismatches);
      const created = await invoices.create(run, { ...step, labels: read.labels }).catch(asRefusal(tool));
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
      const invoiceId = boundInvoiceId(tool, cp, args);
      // Register §8: never e-mailed by PayPal, no note or subject, no extra recipient.
      if (!namesOnlyTheInvoice(args as Record<string, unknown>)) {
        const differences = draftDifferences(args, canonicalSend(invoiceId));
        if (differences.length > 0) throw new AgentToolRefusedError(tool, NOT_CANONICAL, differences);
      }
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
      const sent = await invoices.send(run, approval, step).catch(asRefusal(tool));
      return {
        status: "DONE",
        method: tool,
        invoiceId,
        payerViewUrl: sent.payerViewUrl,
        alreadyDone: sent.alreadyDone,
      };
    }
    case "create_conditional_rules_for_invoice": {
      const invoiceId = boundInvoiceId(tool, cp, args);
      // A rule written out in full must be core's canonical rule exactly; the chain compares it once
      // it knows PayPal's invoice date, and refuses a date other than that date + 25 days, or one not
      // after today or over 30 days out, before the rule call.
      const draft = namesOnlyTheInvoice(args as Record<string, unknown>) ? undefined : args;
      const rule = await invoices.ensureRule(run, { ...step, draft }).catch(asRefusal(tool));
      return {
        status: "DONE",
        method: tool,
        invoiceId,
        autoCancelOn: rule.autoCancelOn,
        alreadyDone: rule.alreadyDone,
      };
    }
    case "get_invoice": {
      const invoiceId = boundInvoiceId(tool, cp, args);
      if (!namesOnlyTheInvoice(args as Record<string, unknown>)) {
        throw new AgentToolRefusedError(
          tool,
          NOT_CANONICAL,
          draftDifferences(args, { invoice_id: invoiceId }),
        );
      }
      const result = await invoices.fetch(run, step).catch(asRefusal(tool));
      return { status: "DONE", method: tool, invoiceId, result };
    }
  }
}
