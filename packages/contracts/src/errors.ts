// Error codes shared by the API, tasks and clients. Every API error body is an `ApiError`.
import { z } from "zod";
import { Sha256Hex } from "./primitives.js";

export const ERROR_CODES = [
  "RATE_CARD_RATIFIED",
  "RULES_BEFORE_FACTS",
  "KILL_SWITCH_ON",
  "DIGEST_MISMATCH",
  "APPROVALS_MISSING",
  "APPROVAL_EXPIRED",
  "NONCE_REUSED",
  "SIGNATURE_INVALID",
  "BLOCKING_HOLDS_OPEN",
  "HOLD_NOT_OPEN",
  "RESOLUTION_NOT_ALLOWED",
  "INVALID_TRANSITION",
  "VERSION_CONFLICT",
  "SANDBOX_GUARD",
  "QUEUED",
  "CIRCUIT_OPEN",
  "RATE_LIMITED",
  "IDEMPOTENCY_KEY_REUSED",
  "CONTENT_DIGEST_MISMATCH",
  "POLICY_DENIED",
  "PAYPAL_REJECTED",
  "PAYPAL_UNAVAILABLE",
  "AI_LIVE_DISABLED",
  "AI_BUDGET",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "FRAME_TOKEN_EXPIRED",
  "PAIRING_TOKEN_INVALID",
  "INTERNAL",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** HTTP status for each code. 409 RATE_CARD_RATIFIED is moment MM-4. */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  RATE_CARD_RATIFIED: 409,
  RULES_BEFORE_FACTS: 422,
  KILL_SWITCH_ON: 423,
  DIGEST_MISMATCH: 409,
  APPROVALS_MISSING: 409,
  APPROVAL_EXPIRED: 422,
  NONCE_REUSED: 409,
  SIGNATURE_INVALID: 422,
  BLOCKING_HOLDS_OPEN: 409,
  HOLD_NOT_OPEN: 409,
  RESOLUTION_NOT_ALLOWED: 422,
  INVALID_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  SANDBOX_GUARD: 403,
  QUEUED: 429,
  CIRCUIT_OPEN: 503,
  RATE_LIMITED: 429,
  IDEMPOTENCY_KEY_REUSED: 422,
  CONTENT_DIGEST_MISMATCH: 422,
  POLICY_DENIED: 403,
  PAYPAL_REJECTED: 502,
  PAYPAL_UNAVAILABLE: 502,
  AI_LIVE_DISABLED: 503,
  AI_BUDGET: 429,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FRAME_TOKEN_EXPIRED: 401,
  PAIRING_TOKEN_INVALID: 410,
  INTERNAL: 500,
};

export const ApiError = z.strictObject({
  code: ErrorCode,
  status: z.int().min(400).max(599),
  message: z.string(),
  requestId: z.string().optional(),
  /** For QUEUED, RATE_LIMITED and CIRCUIT_OPEN: when to try again. */
  retryAfterMs: z.int().nonnegative().optional(),
  /** PayPal's debug_id when PayPal was the cause. */
  paypalDebugId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** MM-4: an edit to the ratified card is refused, citing its hash. */
export const RateCardRatifiedError = ApiError.extend({
  code: z.literal("RATE_CARD_RATIFIED"),
  status: z.literal(409),
  hash: Sha256Hex,
  rateCard: z.string(),
  ratifiedOn: z.iso.date(),
});
export type RateCardRatifiedError = z.infer<typeof RateCardRatifiedError>;

/** Builds an ApiError with the code's HTTP status. */
export function apiError(
  code: ErrorCode,
  message: string,
  extra: Partial<Omit<ApiError, "code" | "status" | "message">> = {},
): ApiError {
  return { code, status: ERROR_HTTP_STATUS[code], message, ...extra };
}
