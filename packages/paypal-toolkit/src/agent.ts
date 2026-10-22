// The agent's door to PayPal. WS-AGENT's tool runner calls this after the policy lattice
// (`decide`) and the ledger; it enforces the register §8 contract again at the execution edge:
// only the four Invoicing tools, `send_invoice` only with the treasurer's approval and never
// e-mailed (send_to_recipient false), and conditional rules only as AUTO_CANCEL on a SPECIFIC_DATE
// under request id `cr-{invoiceId}`. Nothing here moves money; nothing refused is sent.

import { type AgentToolMethod, isAgentToolMethod, TREASURER_APPROVAL_METHODS } from "./actions.js";
import { toolkitZodSchemas } from "./schemas.js";
import type { Tk } from "./tk.js";

export interface TreasurerApproval {
  approverId: string;
  approvedAt: string;
}

export interface AgentToolkitCallOptions {
  /** Present only once Analyn (or Judge-as-Treasurer, labelled) approved this send. */
  treasurerApproval?: TreasurerApproval;
}

export type AgentToolkitResult =
  | { status: "PENDING_APPROVAL"; method: "send_invoice"; args: Record<string, unknown> }
  | { status: "DONE"; method: AgentToolMethod; result: unknown };

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
  ) {
    super(`${tool}: ${reason}`);
    this.name = "AgentToolRefusedError";
  }
}

/** Builds the PayPal-Request-Id for a conditional rule (register §8). */
export const conditionalRuleRequestId = (invoiceId: string): string => `cr-${invoiceId}`;

function parseAgentArgs(tool: AgentToolMethod, args: unknown): Record<string, unknown> {
  const parsed = toolkitZodSchemas().get(tool)?.safeParse(args);
  if (!parsed?.success) throw new AgentToolRefusedError(tool, "arguments do not match the toolkit schema");
  return parsed.data as Record<string, unknown>;
}

function normalizeSend(args: Record<string, unknown>): Record<string, unknown> {
  const extra = args.additional_recipients;
  if (Array.isArray(extra) && extra.length > 0) {
    throw new AgentToolRefusedError("send_invoice", "additional recipients are not allowed");
  }
  // Register §8: always send_to_recipient false, whatever the model asked for.
  const out: Record<string, unknown> = { invoice_id: args.invoice_id, send_to_recipient: false };
  if (typeof args.note === "string") out.note = args.note;
  return out;
}

function assertAutoCancelOnly(args: Record<string, unknown>): string {
  const rules = args.rules;
  if (!Array.isArray(rules) || rules.length !== 1) {
    throw new AgentToolRefusedError("create_conditional_rules_for_invoice", "exactly one AUTO_CANCEL rule");
  }
  const rule = rules[0] as Record<string, unknown>;
  const terms = rule.rule_expiry_terms as Record<string, unknown> | undefined;
  if (
    rule.conditional_rule_type !== "AUTO_CANCEL" ||
    rule.conditional_rule_value !== undefined ||
    rule.conditional_rule_value_type !== undefined ||
    terms?.rule_expiry_condition !== "SPECIFIC_DATE"
  ) {
    throw new AgentToolRefusedError(
      "create_conditional_rules_for_invoice",
      "only AUTO_CANCEL on a SPECIFIC_DATE, with no discount value",
    );
  }
  return String(args.invoice_id);
}

/** Runs one agent tool call through `tk()`, or refuses it before anything is sent. */
export async function runAgentToolkitTool(
  tk: Tk,
  tool: string,
  args: unknown,
  options: AgentToolkitCallOptions = {},
): Promise<AgentToolkitResult> {
  if (!isAgentToolMethod(tool)) throw new AgentToolNotAllowedError(tool);
  const data = parseAgentArgs(tool, args);

  switch (tool) {
    case "send_invoice": {
      const send = normalizeSend(data);
      if (TREASURER_APPROVAL_METHODS.has(tool) && !options.treasurerApproval) {
        return { status: "PENDING_APPROVAL", method: "send_invoice", args: send };
      }
      return { status: "DONE", method: tool, result: await tk(tool, send) };
    }
    case "create_conditional_rules_for_invoice": {
      const invoiceId = assertAutoCancelOnly(data);
      return {
        status: "DONE",
        method: tool,
        result: await tk(tool, data, conditionalRuleRequestId(invoiceId)),
      };
    }
    case "create_invoice":
    case "get_invoice":
      return { status: "DONE", method: tool, result: await tk(tool, data) };
  }
}
