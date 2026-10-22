// Typed errors for @fairsplit/paypal-core. Messages never contain secret values: configuration
// errors name the variable, never its content; OAuth errors carry PayPal's error code only.

import type { PayPalFailure } from "./http.js";

/** Error names PayPal documents for the APIs we call, plus our own `FS_*` names for local failures. */
export type KnownPayPalErrorName =
  | "INVALID_REQUEST"
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_FAILURE"
  | "NOT_AUTHORIZED"
  | "PERMISSION_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "INVALID_RESOURCE_ID"
  | "METHOD_NOT_SUPPORTED"
  | "MEDIA_TYPE_NOT_ACCEPTABLE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RESOURCE_CONFLICT"
  | "UNPROCESSABLE_ENTITY"
  | "RATE_LIMIT_REACHED"
  | "INTERNAL_SERVER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "USER_BUSINESS_ERROR"
  | "INSUFFICIENT_FUNDS"
  | "SENDER_EMAIL_UNCONFIRMED"
  | "WEBHOOK_URL_ALREADY_EXISTS"
  | "WEBHOOK_NUMBER_LIMIT_EXCEEDED"
  | "FS_LIMITER_DENIED"
  | "FS_CIRCUIT_OPEN"
  | "FS_TIMEOUT"
  | "FS_NETWORK_ERROR"
  | "FS_AUTH_FAILED"
  | "FS_INVALID_REQUEST";

/** A PayPal error name: one of the known names, or any other string PayPal returns. */
export type PayPalErrorName = KnownPayPalErrorName | (string & {});

export type PayPalConfigErrorCode =
  | "MISSING_ENV"
  | "NOT_SANDBOX"
  | "LIVE_DISABLED"
  | "DEV_MOCKS_IN_PRODUCTION"
  | "WEBHOOK_ID_IS_MOCK_LITERAL"
  | "INVALID_HOST"
  | "INVALID_VALUE";

/** Raised at boot or construction time. `variables` lists env names only, never values. */
export class PayPalConfigError extends Error {
  override readonly name = "PayPalConfigError";
  constructor(
    readonly code: PayPalConfigErrorCode,
    message: string,
    readonly variables: readonly string[] = [],
  ) {
    super(message);
  }
}

export type PayPalAuthErrorKind = "http" | "timeout" | "network" | "invalid_response";

/** OAuth client-credentials failure. `oauthError` is PayPal's `error` field (e.g. `invalid_client`). */
export class PayPalAuthError extends Error {
  override readonly name = "PayPalAuthError";
  constructor(
    readonly kind: PayPalAuthErrorKind,
    message: string,
    readonly status: number,
    readonly oauthError: string | null,
    readonly debugId: string | null,
  ) {
    super(message);
  }
}

/** The token is missing a scope that Fair Split cannot run without (checked at boot). */
export class PayPalScopeError extends Error {
  override readonly name = "PayPalScopeError";
  constructor(
    message: string,
    readonly missing: readonly string[],
  ) {
    super(message);
  }
}

/** Thrown by `expectOk()` for callers that prefer exceptions over the result union. */
export class PayPalHttpError extends Error {
  override readonly name = "PayPalHttpError";
  readonly status: number;
  readonly debugId: string | null;
  readonly paypalName: PayPalErrorName;
  constructor(readonly failure: PayPalFailure) {
    super(
      `PayPal ${failure.kind} failure: ${failure.name} (status ${failure.status}, debug_id ${failure.debugId ?? "none"})`,
    );
    this.status = failure.status;
    this.debugId = failure.debugId;
    this.paypalName = failure.name;
  }
}
