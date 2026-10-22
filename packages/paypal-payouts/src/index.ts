// @fairsplit/paypal-payouts: the typed Payouts v1 tool in the Agent Toolkit Tool shape, with PR #107's
// names (zod 3), and PayoutsService, the only caller of the two money-moving endpoints.
// The money-moving functions (create, cancel) are deliberately not exported: they are reachable
// only through PayoutsService, behind the kill switch, the approvals and the I4 digest check.

export type { Actor, ActorKind, ApprovalPayload, ApprovalRole, SignedApproval } from "./_shims/contracts.js";
export type {
  BatchDigestFn,
  BatchDigestRun,
  CosignInput,
  CosignReason,
  CosignRule,
  PayoutItemSpec,
} from "./_shims/domain.js";
export type {
  CallPriority,
  CallPurpose,
  PayPalAuth,
  PayPalFailureKind,
  PayPalHttp,
  PayPalLink,
  PayPalRequest,
  PayPalResult,
} from "./_shims/paypal-core.js";
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
  APPROVAL_MAX_TTL_MS,
  type ApprovedLine,
  type BatchOutcome,
  type CancelIntent,
  type CancelOutcome,
  DEFAULT_RETRY_DELAYS_MS,
  isDuplicateBatchError,
  linkedBatchId,
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
  type SubmittedBatch,
  type SubmittedItem,
  type SubmittedMark,
  type SupersedingItem,
  type UnresolvedReason,
} from "./service.js";
export {
  AGENT_PAYOUT_ACTIONS,
  AGENT_PAYOUT_METHODS,
  type AgentPayoutMethod,
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
  payoutTools,
  runAgentPayoutTool,
  SERVER_ONLY_PAYOUT_METHODS,
  type Tool,
} from "./tools.js";
