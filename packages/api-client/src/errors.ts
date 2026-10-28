// Typed failures. Every API error body is an IC-01 `ApiError`; the client turns it into an `ApiClientError`
// whose `code` is narrowed to what that command can answer (`CommandErrorCode<N>`), so a screen can switch
// on it exhaustively. Two other failures exist: the request never got an answer (`NetworkError`), or the
// answer broke the contract (`ContractError`: a body that does not parse, or drift from the zod schema).
import {
  ApiError,
  type ErrorCode,
  ErrorCode as ErrorCodeSchema,
  RateCardRatifiedError,
} from "@fairsplit/contracts";
import { NOT_IMPLEMENTED_REASON, NOT_IMPLEMENTED_STATUS, type RailLabel } from "./http.js";

const BASE_KEYS = [
  "code",
  "status",
  "message",
  "requestId",
  "retryAfterMs",
  "paypalDebugId",
  "details",
] as const;

export interface ErrorContext {
  /** The command name, or `METHOD /path` for an untyped request. */
  command: string;
  rail: RailLabel | null;
  requestId: string | null;
}

export class ApiClientError<C extends ErrorCode = ErrorCode> extends Error {
  override readonly name = "ApiClientError";
  readonly code: C;
  readonly status: number;
  readonly requestId: string | null;
  /** For QUEUED, RATE_LIMITED, CIRCUIT_OPEN and AI_BUDGET: when to try again. */
  readonly retryAfterMs: number | null;
  /** PayPal's debug_id when PayPal was the cause (show it: judges like seeing real debug IDs). */
  readonly paypalDebugId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  /** The whole body, including fields of extended shapes (RATE_CARD_RATIFIED adds hash, rateCard, ratifiedOn). */
  readonly body: Readonly<ApiError & Record<string, unknown>>;
  readonly command: string;
  readonly rail: RailLabel | null;

  constructor(body: ApiError & Record<string, unknown>, ctx: ErrorContext) {
    super(body.message);
    this.code = body.code as C;
    this.status = body.status;
    this.requestId = body.requestId ?? ctx.requestId;
    this.retryAfterMs = body.retryAfterMs ?? null;
    this.paypalDebugId = body.paypalDebugId ?? null;
    this.details = body.details ?? {};
    this.body = body;
    this.command = ctx.command;
    this.rail = ctx.rail;
  }

  /** True when the command is registered but its slice has not filled it in yet (501). */
  get notImplemented(): boolean {
    return this.status === NOT_IMPLEMENTED_STATUS && this.details.reason === NOT_IMPLEMENTED_REASON;
  }

  /** Narrow to one or more codes: `if (e.is("HOLD_NOT_OPEN")) …`. */
  is<K extends C>(...codes: K[]): this is ApiClientError<K> {
    return (codes as readonly ErrorCode[]).includes(this.code);
  }
}

/** The request got no HTTP answer: offline, DNS, reset, or aborted by the caller. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
  readonly command: string;
  readonly aborted: boolean;
  constructor(command: string, cause: unknown, aborted: boolean) {
    super(aborted ? `${command} was aborted` : `${command} got no answer (network)`, { cause });
    this.command = command;
    this.aborted = aborted;
  }
}

/** The server answered something the contract does not allow (unparsable JSON, drift, unknown error code). */
export class ContractError extends Error {
  override readonly name = "ContractError";
  readonly command: string;
  readonly status: number;
  readonly issues: readonly { path: string; message: string }[];
  readonly requestId: string | null;
  constructor(
    command: string,
    status: number,
    message: string,
    issues: readonly { path: string; message: string }[] = [],
    requestId: string | null = null,
  ) {
    super(`${command}: ${message}`);
    this.command = command;
    this.status = status;
    this.issues = issues;
    this.requestId = requestId;
  }
}

export type ClientFailure<C extends ErrorCode = ErrorCode> = ApiClientError<C> | NetworkError | ContractError;

export function isApiClientError<K extends ErrorCode>(e: unknown, ...codes: K[]): e is ApiClientError<K> {
  return (
    e instanceof ApiClientError && (codes.length === 0 || (codes as readonly ErrorCode[]).includes(e.code))
  );
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}

export function isContractError(e: unknown): e is ContractError {
  return e instanceof ContractError;
}

/** True for a 501 from a registered command whose slice has not landed yet. */
export function isNotImplemented(e: unknown): boolean {
  return e instanceof ApiClientError && e.notImplemented;
}

/** MM-4: the full refusal (`hash`, `rateCard`, `ratifiedOn`) when `e` is a 409 RATE_CARD_RATIFIED, else null. */
export function asRateCardRatified(e: unknown): RateCardRatifiedError | null {
  if (!(e instanceof ApiClientError) || e.code !== "RATE_CARD_RATIFIED") return null;
  const parsed = RateCardRatifiedError.safeParse(e.body);
  return parsed.success ? parsed.data : null;
}

/**
 * Builds the failure for a non-2xx answer. An IC-01 `ApiError` body becomes an `ApiClientError` (extended
 * shapes keep their extra fields in `body`); anything else is a `ContractError`.
 */
export function failureFromBody(
  status: number,
  text: string,
  ctx: ErrorContext,
): ApiClientError | ContractError {
  let json: unknown;
  try {
    json = text === "" ? undefined : JSON.parse(text);
  } catch {
    return new ContractError(
      ctx.command,
      status,
      `answered ${status} with a body that is not JSON`,
      [],
      ctx.requestId,
    );
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return new ContractError(
      ctx.command,
      status,
      `answered ${status} without an ApiError body`,
      [],
      ctx.requestId,
    );
  }
  const record = json as Record<string, unknown>;
  const base = Object.fromEntries(BASE_KEYS.filter((k) => k in record).map((k) => [k, record[k]]));
  const parsed = ApiError.safeParse(base);
  if (!parsed.success) {
    const unknownCode = !ErrorCodeSchema.safeParse(record.code).success;
    return new ContractError(
      ctx.command,
      status,
      unknownCode ? `answered an unknown error code ${String(record.code)}` : "answered a malformed ApiError",
      parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
      ctx.requestId,
    );
  }
  return new ApiClientError({ ...record, ...parsed.data }, ctx);
}
