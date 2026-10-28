// @fairsplit/paypal-toolkit: the only importer of @paypal/agent-toolkit (1.11.0, zod 3).
// Graft G1: tool JSON Schemas come from the toolkit's /openai export; every execution, agent or
// deterministic, goes through the toolkit's PayPalAPI (from /mcp) on our injected token.

// WS-CORE's contracts this package's signatures carry, re-exported for the same reason.
export type { InvoiceQuote, InvoiceQuoteItem, Provenance, QuoteItemKey } from "@fairsplit/contracts";
// IC-05 as WS-PPCORE built it, re-exported so callers wire tk() from one import.
export type {
  CallPriority,
  CallPurpose,
  LimiterDecision,
  PayPalAuth,
  PayPalLimiter,
  PayPalToken,
} from "@fairsplit/paypal-core";
export {
  AGENT_ACTIONS,
  AGENT_TOOL_METHODS,
  type AgentToolMethod,
  isAgentToolMethod,
  isToolkitMethod,
  MONEY_MOVING_TOOLKIT_METHODS,
  SERVER_ACTIONS,
  SERVER_ONLY_METHODS,
  type ServerOnlyMethod,
  TOOLKIT_METHODS,
  type ToolkitMethod,
  TREASURER_APPROVAL_METHODS,
} from "./actions.js";
export {
  type AgentInvoiceSession,
  type AgentToolkitCallOptions,
  type AgentToolkitResult,
  AgentToolNotAllowedError,
  AgentToolRefusedError,
  runAgentToolkitTool,
} from "./agent.js";
export { ppDate } from "./dates.js";
export {
  type AgentCreateRead,
  approvalCovers,
  autoCancelWindowError,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  type CreateInvoiceItem,
  conditionalRuleRequestId,
  draftDifferences,
  type InvoicePayer,
  type InvoicePlan,
  InvoicePlanError,
  type InvoiceRun,
  invoiceMemo,
  invoiceNumberFor,
  invoiceSendApproval,
  rateCardReference,
  readAgentCreate,
  runSlug,
  seasonIdCode,
  sendArgsSha256,
  type TreasurerApproval,
} from "./invoice-plan.js";
export {
  type CreateStepResult,
  EMPTY_INVOICE_CHECKPOINT,
  type EnsureInvoiceOptions,
  type EnsureInvoiceResult,
  type FundingCheck,
  InvoiceAdoptError,
  InvoiceApprovalError,
  type InvoiceCheckpoint,
  InvoiceDraftRejectedError,
  InvoiceNotPayableError,
  type InvoiceRepository,
  InvoiceStateError,
  type InvoiceStepOptions,
  Invoices,
  type InvoicesDeps,
  invoiceIdFromCreate,
  invoiceMoneyExtras,
  type PayPalMode,
  payerViewUrlFromSend,
  RECORD_PAYMENT_NOTE,
  type RecordPaymentResult,
  type RuleStepResult,
  type SendStepResult,
} from "./invoices.js";
export { centsToValue, readValueCents, valueToCents } from "./money.js";
export { type InvoicePolicy, InvoicePolicyDeniedError, type InvoicePolicyEnv } from "./policy.js";
export {
  type AgentToolSchema,
  agentToolSchemas,
  assertToolkitAllowlists,
  PINNED_TOOLKIT_VERSION,
  ToolkitAllowlistError,
  toolkitActionKeys,
  toolkitVersion,
  toolkitZodSchemas,
} from "./schemas.js";
export {
  createTk,
  DEFAULT_TIMEOUT_MS,
  PayPalToolkit,
  type Tk,
  type TkOptions,
  TOOLKIT_SANDBOX,
  TOOLKIT_SOURCE,
  ToolkitArgsError,
  type ToolkitCallRecord,
  type ToolkitDeps,
  ToolkitError,
  ToolkitLimitedError,
  type ToolkitLimiter,
  ToolkitMethodError,
} from "./tk.js";
