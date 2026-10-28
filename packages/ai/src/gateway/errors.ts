import type { GatewayResult } from "./types.js";

/**
 * Typed gateway failures. Every failure means "a person handles it" upstream; the code says why.
 * - AI_LIVE_DISABLED: kill_ai_live is on, or the call is replay_only and nothing is recorded.
 * - AI_BUDGET: the estimate would push the lane's spend (today's, or the eval run's) past its cap, or
 *   today's total past the overall daily cap.
 * - AI_STOP_REASON: the model stopped for a reason the caller does not accept (max_tokens, refusal, ...).
 * - AI_MODEL_MISMATCH: the response names a model other than the one requested (S4.1 step 7 asserts
 *   `model_served` equals the request; no fallbacks are ever requested).
 * - AI_SCHEMA: the structured output did not parse against the schema.
 * - AI_REQUEST_RULE: the request broke a gateway rule (sampling params, forced tool_choice, ...).
 * - AI_UPSTREAM: the API failed after the SDK's retries (network, 5xx, 429, 4xx).
 * - AI_BAD_CALL: the GatewayCall itself is malformed.
 * - AI_CONFIG: the gateway was built without the controls it needs (spend meter, flag source).
 */
export type GatewayErrorCode =
  | "AI_LIVE_DISABLED"
  | "AI_BUDGET"
  | "AI_STOP_REASON"
  | "AI_MODEL_MISMATCH"
  | "AI_SCHEMA"
  | "AI_REQUEST_RULE"
  | "AI_UPSTREAM"
  | "AI_BAD_CALL"
  | "AI_CONFIG";

export interface GatewayErrorDetails {
  cacheKey?: string;
  reason?: string;
  stopReason?: string | null;
  modelServed?: string;
  result?: GatewayResult;
  /**
   * A pipeline that failed on this error: every call of it that did run (the failed call too, when it
   * ran), so the caller still accounts for their cost.
   */
  calls?: GatewayResult[];
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
