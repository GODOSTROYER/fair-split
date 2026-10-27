// @fairsplit/paypal-payouts: the typed Payouts v1 tool in the Agent Toolkit Tool shape, with PR #107's
// names (zod 3), and PayoutsService, the only caller of the two money-moving endpoints.
// The money-moving functions (create, cancel) are deliberately not exported: they are reachable
// only through PayoutsService, behind the kill switch, the approvals and the I4 digest check.

// WS-CORE's contracts the service's signatures carry, re-exported for the same reason.
export type {
  Actor,
  ActorKind,
  ApprovalPayload,
  ApprovalRole,
  EngineHold,
  OfficerKey,
  SignedApproval,
} from "@fairsplit/contracts";
export { APPROVAL_MAX_TTL_MS, type ApprovalCheckCode } from "@fairsplit/domain";
// IC-05 as WS-PPCORE built it, re-exported so callers wire the service from one import.
export type {
  CallPriority,
  CallPurpose,
  PayPalFailure,
  PayPalFailureKind,
  PayPalHttp,
  PayPalLink,
  PayPalRequest,
  PayPalResult,
  PayPalSuccess,
} from "@fairsplit/paypal-core";
export { type FairSplitPayoutBatch, fairSplitPayoutBatch, fairSplitPayoutItem } from "./fair-split-schema.js";
export {
  type CreatePayoutBatchResponse,
  getPayoutBatch,
  getPayoutItem,
  type PayoutBatchHeader,
  type PayoutBatchResponse,
  type PayoutCallOptions,
  type PayoutItemResponse,
  PayoutParamsError,
} from "./functions.js";
export {
  batchNote,
  PayoutIdError,
  parseSenderItemId,
  payPalRequestId,
  rc8,
  SENDER_BATCH_ID_MAX,
  SENDER_ITEM_ID_MAX,
  seasonIdCode,
  senderBatchId,
  senderItemId,
} from "./ids.js";
export { centsToValue, readValueCents } from "./money.js";
export {
  type CancelUnclaimedPayoutItemParams,
  type Context,
  type CreatePayoutBatchParams,
  cancelUnclaimedPayoutItemParameters,
  createPayoutBatchParameters,
  type GetPayoutBatchParams,
  type GetPayoutItemParams,
  getPayoutBatchParameters,
  getPayoutItemParameters,
} from "./parameters.js";
export {
  cancelUnclaimedPayoutItemPrompt,
  createPayoutBatchPrompt,
  getPayoutBatchPrompt,
  getPayoutItemPrompt,
} from "./prompts.js";
export { PAYOUT_BATCH_ID_REGEX, PAYOUT_ITEM_ID_REGEX, POSITIVE_DECIMAL_STRING_REGEX } from "./regex.js";
export {
  type ApprovedLine,
  type BatchOutcome,
  type CancelIntent,
  type CancelOutcome,
  DEFAULT_RETRY_DELAYS_MS,
  isDuplicateBatchError,
  linkedBatchId,
  type MemberLineHash,
  PAYPAL_MAX_BATCH_ITEMS,
  type PayoutItemRow,
  type PayoutLimits,
  type PayoutRunFacts,
  type PayoutsRepository,
  PayoutsService,
  type PayoutsServiceDeps,
  type PostingSnapshot,
  type RefusalCode,
  type RerouteRequest,
  type RunHold,
  type SubmittedBatch,
  type SubmittedItem,
  type SubmittedMark,
  type SupersedingItem,
  type UnresolvedReason,
} from "./service.js";
export {
  AGENT_PAYOUT_ACTIONS,
  AGENT_PAYOUT_METHODS,
  AGENT_PAYOUT_PAGE_SIZE_MAX,
  type AgentPayoutMethod,
  type AgentPayoutSession,
  type AgentPayoutToolSchema,
  ALL_PAYOUT_TOOLS_ENABLED,
  agentPayoutToolSchemas,
  agentPayoutTools,
  type Configuration,
  isToolAllowed,
  PAYOUT_METHODS,
  type PayoutMethod,
  PayoutsApiError,
  PayoutToolNotAllowedError,
  PayoutToolRefusedError,
  payoutTools,
  runAgentPayoutTool,
  SERVER_ONLY_PAYOUT_METHODS,
  type Tool,
} from "./tools.js";
