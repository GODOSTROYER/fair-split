// The one way a handler says "no": throw an ApiProblem. The error middleware turns it into the IC-01
// `ApiError` body with the code's HTTP status (contracts `ERROR_HTTP_STATUS`), the request id, and
// any `retryAfterMs` as a `Retry-After` header. Anything else that escapes a handler becomes 500 INTERNAL
// without leaking its message.
import { NOT_IMPLEMENTED_REASON, NOT_IMPLEMENTED_STATUS } from "@fairsplit/api-client/http";
import { ApiError, ERROR_HTTP_STATUS, type ErrorCode } from "@fairsplit/contracts";

export interface ProblemExtra {
  /** For QUEUED, RATE_LIMITED and CIRCUIT_OPEN: when to try again (also sent as Retry-After). */
  retryAfterMs?: number;
  /** PayPal's debug_id when PayPal was the cause. */
  paypalDebugId?: string;
  details?: Record<string, unknown>;
  /**
   * Overrides the code's HTTP status. Used only by NOT_IMPLEMENTED (501 with code INTERNAL, because the
   * frozen IC-01 error list has no NOT_IMPLEMENTED code).
   */
  status?: number;
  /** Extra top-level fields for error shapes that extend ApiError (RateCardRatifiedError: hash, rateCard, ratifiedOn). */
  fields?: Record<string, unknown>;
  cause?: unknown;
}

export class ApiProblem extends Error {
  override readonly name = "ApiProblem";
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Omit<ProblemExtra, "cause" | "status">;

  constructor(code: ErrorCode, message: string, extra: ProblemExtra = {}) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.code = code;
    this.status = extra.status ?? ERROR_HTTP_STATUS[code];
    const { cause: _cause, status: _status, ...rest } = extra;
    this.extra = rest;
  }

  /** The response body: always a valid `ApiError` (plus `fields` for extended shapes). */
  toBody(requestId?: string): ApiError & Record<string, unknown> {
    const body: ApiError & Record<string, unknown> = {
      ...(this.extra.fields ?? {}),
      code: this.code,
      status: this.status,
      message: this.message,
      ...(requestId ? { requestId } : {}),
      ...(this.extra.retryAfterMs !== undefined
        ? { retryAfterMs: Math.max(0, Math.ceil(this.extra.retryAfterMs)) }
        : {}),
      ...(this.extra.paypalDebugId ? { paypalDebugId: this.extra.paypalDebugId } : {}),
      ...(this.extra.details ? { details: this.extra.details } : {}),
    };
    return body;
  }
}

export function isApiProblem(e: unknown): e is ApiProblem {
  return e instanceof ApiProblem;
}

/** Status (501) and details.reason of a command a slice has not filled in yet (shared with the client). */
export { NOT_IMPLEMENTED_REASON, NOT_IMPLEMENTED_STATUS };

/** Shorthands for the boundary errors every handler may raise. */
export const problem = {
  validation(message: string, issues?: readonly ValidationIssue[]): ApiProblem {
    return new ApiProblem("VALIDATION_FAILED", message, issues ? { details: { issues } } : {});
  },
  unauthenticated(message = "Sign in again: this request carries no valid credential."): ApiProblem {
    return new ApiProblem("UNAUTHENTICATED", message);
  },
  expired(message = "This token has expired."): ApiProblem {
    return new ApiProblem("FRAME_TOKEN_EXPIRED", message);
  },
  forbidden(message = "This credential may not do that."): ApiProblem {
    return new ApiProblem("FORBIDDEN", message);
  },
  notFound(what = "Not found"): ApiProblem {
    return new ApiProblem("NOT_FOUND", what);
  },
  rateLimited(retryAfterMs: number, message = "Too many requests. Try again shortly."): ApiProblem {
    return new ApiProblem("RATE_LIMITED", message, { retryAfterMs });
  },
  internal(message = "Something went wrong on our side.", cause?: unknown): ApiProblem {
    return new ApiProblem("INTERNAL", message, cause === undefined ? {} : { cause });
  },
  /** 501 for a registered command whose slice has not filled in the handler yet. */
  notImplemented(command: string, slice: string): ApiProblem {
    return new ApiProblem("INTERNAL", `${command} is not implemented yet`, {
      status: NOT_IMPLEMENTED_STATUS,
      details: { reason: NOT_IMPLEMENTED_REASON, command, slice },
    });
  },
  /**
   * MM-4: 409 RATE_CARD_RATIFIED in the IC-01 `RateCardRatifiedError` shape (top-level `hash`, `rateCard`,
   * `ratifiedOn`), so the bolted slab can cite the hash. `addDeduction` always answers with this.
   */
  rateCardRatified(
    card: { hash: string; rateCard: string; ratifiedOn: string },
    cause?: unknown,
  ): ApiProblem {
    return new ApiProblem(
      "RATE_CARD_RATIFIED",
      `Refused: the rate card was ratified on ${card.ratifiedOn} and is bolted (sha256 ${card.hash.slice(0, 8)}…).`,
      {
        fields: { hash: card.hash, rateCard: card.rateCard, ratifiedOn: card.ratifiedOn },
        details: { hash: card.hash },
        ...(cause === undefined ? {} : { cause }),
      },
    );
  },
} as const;

export interface ValidationIssue {
  /** Where: "body.resolution", "params.runSlug", "query.role", "headers.idempotency-key". */
  path: string;
  message: string;
  code: string;
}

/** True when `body` is a well-formed IC-01 ApiError (used by tests and the response checker). */
export function isApiErrorBody(body: unknown): body is ApiError {
  return ApiError.safeParse(stripExtensions(body)).success;
}

/** ApiError is strict; extended shapes (RateCardRatifiedError) carry extra keys, so compare on the base keys. */
function stripExtensions(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const keys = ["code", "status", "message", "requestId", "retryAfterMs", "paypalDebugId", "details"];
  return Object.fromEntries(Object.entries(body).filter(([k]) => keys.includes(k)));
}
