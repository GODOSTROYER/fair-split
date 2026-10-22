// @fairsplit/paypal-core: OAuth single-flight, PayPalHttp, webhook self-verification, event to status map (zod 3).
// IC-05: PayPalAuth.token(), PayPalHttp.request() → result union with debugId, verifyPayPal(), toItemStatus().

export {
  runSetupWebhooks,
  SETUP_WEBHOOKS_USAGE,
  type SetupWebhooksDeps,
  type SetupWebhooksIo,
} from "./admin/setup-webhooks.js";
export {
  checkWebhookRegistration,
  type EnsureLookupResult,
  type EnsureWebhookAction,
  type EnsureWebhookOptions,
  type EnsureWebhookResult,
  ensureWebhook,
  ensureWebhookLookup,
  type ListedWebhookEvent,
  listWebhookEvents,
  listWebhooks,
  type RegisteredWebhook,
  type RegistrationCheck,
  resendWebhookEvent,
} from "./admin/webhooks.js";
export {
  createPayPalAuth,
  type PayPalAuth,
  type PayPalAuthConfig,
  type PayPalAuthStatus,
  type PayPalToken,
  TOKEN_REFRESH_SKEW_MS,
} from "./auth.js";
export { loadPayPalConfig, type PayPalRuntimeConfig } from "./config.js";
export { createPayPalCore, type PayPalCore, type PayPalCoreOptions } from "./core.js";
export {
  isPayPalHost,
  PAYPAL_API_BASE_URL,
  PAYPAL_API_HOSTS,
  PAYPAL_CERT_SUBJECTS,
  type PayPalEnv,
} from "./env.js";
export {
  type KnownPayPalErrorName,
  PayPalAuthError,
  type PayPalAuthErrorKind,
  PayPalConfigError,
  type PayPalConfigErrorCode,
  type PayPalErrorName,
  PayPalHttpError,
  PayPalScopeError,
} from "./errors.js";
export {
  createPayPalHttp,
  DEFAULT_RETRY_POLICY,
  type Delivery,
  expectOk,
  type HttpMethod,
  type PayPalErrorDetail,
  type PayPalFailure,
  type PayPalFailureKind,
  type PayPalHttp,
  type PayPalHttpConfig,
  type PayPalLink,
  type PayPalRequest,
  type PayPalResult,
  type PayPalSuccess,
  parsePayPalError,
  type RetryPolicy,
} from "./http.js";
export {
  decideItemStatus,
  ITEM_STATUS_RANK,
  ITEM_STATUSES,
  type ItemStatus,
  type ItemStatusDecision,
  itemStatusRank,
  parseItemStatus,
  toItemStatus,
} from "./item-status.js";
export {
  createMemoryLimiter,
  LIMITER_DEFAULTS,
  type LimiterDecision,
  type LimiterDenyReason,
  type LimiterRequest,
  type LimiterSnapshot,
  type MemoryLimiter,
  type MemoryLimiterOptions,
  type PayPalLimiter,
  unlimitedLimiter,
} from "./limiter.js";
export type { CallOutcome, PayPalCallRecord, PayPalCallRecorder } from "./recorder.js";
export {
  assertScopes,
  type CapabilityState,
  checkScopes,
  PAYPAL_SCOPES,
  type PayPalCapability,
  type ScopeReport,
} from "./scopes.js";
export {
  type CallPriority,
  type CallPurpose,
  type FetchLike,
  type HeadersLike,
  type LoggerLike,
  readHeader,
} from "./types.js";
export { type CertUrlCheck, type CertUrlRejection, checkCertUrl } from "./webhook/cert-url.js";
export {
  type CertCache,
  type CertCheckFailure,
  checkLeafCertificate,
  createMemoryCertCache,
  type LoadedCert,
  parsePemChain,
} from "./webhook/certs.js";
export {
  type EnvelopeParse,
  isSubscribedEventType,
  parseWebhookEnvelope,
  type ResourceRef,
  resourceKeyOf,
  resourceRefOf,
  WEBHOOK_EVENT_TYPES,
  type WebhookEnvelope,
  type WebhookEventType,
} from "./webhook/event.js";
export { buildPostbackBody, createPostbackVerifier } from "./webhook/postback.js";
export {
  createPayPalWebhookVerifier,
  MOCK_WEBHOOK_ID,
  type PayPalWebhookVerifier,
  type PostbackFn,
  type PostbackInput,
  type PostbackResult,
  type RawBody,
  type VerifyFailureReason,
  type VerifyMode,
  type VerifyOptions,
  type VerifyOutcome,
  verifyPayPal,
  type WebhookVerifierConfig,
} from "./webhook/verify.js";
