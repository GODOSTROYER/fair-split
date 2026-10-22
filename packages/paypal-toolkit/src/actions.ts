// The allowlists (register §8). Action keys are the real @paypal/agent-toolkit 1.11.0 keys; the
// toolkit's isToolAllowed silently ignores unknown keys, so schemas.ts asserts that each set
// resolves to exactly the methods listed here, and a contract test checks it against the package.

/** What the audit agent (AI-7) may call: Invoicing v2 through the toolkit, nothing that moves money. */
export const AGENT_TOOL_METHODS = [
  "create_invoice",
  "send_invoice",
  "create_conditional_rules_for_invoice",
  "get_invoice",
] as const;

/** Server-only: never declared to the model. */
export const SERVER_ONLY_METHODS = ["record_payment_for_invoice", "search_invoicing"] as const;

export const TOOLKIT_METHODS = [...AGENT_TOOL_METHODS, ...SERVER_ONLY_METHODS] as const;

export type AgentToolMethod = (typeof AGENT_TOOL_METHODS)[number];
export type ServerOnlyMethod = (typeof SERVER_ONLY_METHODS)[number];
export type ToolkitMethod = (typeof TOOLKIT_METHODS)[number];

export const AGENT_ACTIONS = {
  invoices: { create: true, send: true, createConditionalRules: true, get: true },
} as const;

export const SERVER_ACTIONS = {
  invoices: { ...AGENT_ACTIONS.invoices, recordPayment: true, search: true },
} as const;

/** sendNeedsTreasurer (S4 policy lattice): the agent may draft a send, only Analyn's approval sends it. */
export const TREASURER_APPROVAL_METHODS: ReadonlySet<AgentToolMethod> = new Set<AgentToolMethod>([
  "send_invoice",
]);

/** Every call the toolkit could make that moves, refunds, cancels or deletes something; none is ever exposed. */
export const MONEY_MOVING_TOOLKIT_METHODS = [
  "record_payment_for_invoice",
  "record_refund_for_invoice",
  "cancel_sent_invoice",
  "delete_invoice",
  "update_invoicing",
  "create_order",
  "pay_order",
  "create_refund",
  "accept_dispute_claim",
  "create_subscription",
  "cancel_subscription",
  "update_subscription",
] as const;

const TOOLKIT_METHOD_SET: ReadonlySet<string> = new Set(TOOLKIT_METHODS);
const AGENT_METHOD_SET: ReadonlySet<string> = new Set(AGENT_TOOL_METHODS);

export function isToolkitMethod(name: string): name is ToolkitMethod {
  return TOOLKIT_METHOD_SET.has(name);
}

export function isAgentToolMethod(name: string): name is AgentToolMethod {
  return AGENT_METHOD_SET.has(name);
}
