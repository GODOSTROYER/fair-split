// @fairsplit/paypal-core: OAuth single-flight, PayPalHttp, webhook self-verification, event to status map (zod 3).
// IC-05: PayPalAuth.token(), PayPalHttp.request() → result union with debugId, verifyPayPal(), toItemStatus().

export {
  parseWebhookApp,
  runSetupWebhooks,
  SETUP_WEBHOOKS_USAGE,
  type SetupWebhooksDeps,
  type SetupWebhooksIo,
  type WebhookApp,
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
  type ListWebhookEventsOptions,
  type ListWebhookEventsResult,
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
export {
  CERT_ID_PATTERN,
  type CertUrlCheck,
  type CertUrlRejection,
  checkCertUrl,
} from "./webhook/cert-url.js";
export {
  type CertCache,
  type CertCheckFailure,
  type CertPropertyFailure,
  type CertValidityFailure,
  checkCertValidity,
  checkLeafCertificate,
  checkLeafProperties,
  createMemoryCertCache,
  type LoadedCert,
  parsePemChain,
} from "./webhook/certs.js";
export { clientIpKey, UNKNOWN_CLIENT } from "./webhook/client-ip.js";
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
export {
  buildPostbackBody,
  createPostbackVerifier,
  POSTBACK_DEADLINE_MS,
  POSTBACK_TIMEOUT_MS,
  type PostbackVerifierOptions,
  postbackWithDeadline,
} from "./webhook/postback.js";
export {
  type CertFetchBudget,
  type CertWarning,
  createMemoryTransmissionStore,
  createPayPalWebhookVerifier,
  DEFAULT_CERT_FETCH_BUDGET,
  DEFAULT_EXPIRED_CERT_POSTBACKS_PER_HOUR,
  type ExpiredCertPolicy,
  MAX_TRANSMISSION_SKEW_MS,
  MAX_WEBHOOK_BODY_BYTES,
  MOCK_WEBHOOK_ID,
  PAYPAL_CERT_ID_PATTERN,
  type PayPalWebhookVerifier,
  type PostbackFn,
  type PostbackInput,
  type PostbackResult,
  type PrewarmResult,
  parseTransmissionTime,
  type RawBody,
  TRANSMISSION_ID_PATTERN,
  type TransmissionStore,
  type VerifyFailureReason,
  type VerifyMode,
  type VerifyOptions,
  type VerifyOutcome,
  verifyPayPal,
  type WebhookVerifierAlert,
  type WebhookVerifierConfig,
  type WebhookVerifierHealth,
} from "./webhook/verify.js";
