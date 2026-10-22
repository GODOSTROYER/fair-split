import type { GatewayResult } from "./types.js";

/**
 * Typed gateway failures. Every failure means "a person handles it" upstream; the code says why.
 * - AI_LIVE_DISABLED: kill_ai_live is on, or the call is replay_only and nothing is recorded.
 * - AI_BUDGET: the estimate would push today's spend on the budget key past its cap.
 * - AI_STOP_REASON: the model stopped for a reason the caller does not accept (max_tokens, refusal, ...).
 * - AI_SCHEMA: the structured output did not parse against the schema.
 * - AI_REQUEST_RULE: the request broke a gateway rule (sampling params, forced tool_choice, ...).
 * - AI_UPSTREAM: the API failed after the SDK's retries (network, 5xx, 429, 4xx).
 * - AI_BAD_CALL: the GatewayCall itself is malformed.
 */
export type GatewayErrorCode =
  | "AI_LIVE_DISABLED"
  | "AI_BUDGET"
  | "AI_STOP_REASON"
  | "AI_SCHEMA"
  | "AI_REQUEST_RULE"
  | "AI_UPSTREAM"
  | "AI_BAD_CALL";

export interface GatewayErrorDetails {
  cacheKey?: string;
  reason?: string;
  stopReason?: string | null;
  result?: GatewayResult;
  status?: number;
  estimateMicros?: number;
  capMicros?: number;
  spentMicros?: number;
}

export class GatewayError extends Error {
  override readonly name = "GatewayError";
  readonly code: GatewayErrorCode;
  readonly details: GatewayErrorDetails;

  constructor(code: GatewayErrorCode, message: string, details: GatewayErrorDetails = {}, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.code = code;
    this.details = details;
  }
}

export function isGatewayError(err: unknown, code?: GatewayErrorCode): err is GatewayError {
  return err instanceof GatewayError && (code === undefined || err.code === code);
}

/** The copy the UI shows when live reading is paused (S4.1 step 3). */
export const LIVE_DISABLED_COPY = "Live reading is paused; showing the recorded run.";
