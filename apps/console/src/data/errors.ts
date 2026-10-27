// Errors a command can end in. The API answers every failure with an IC-01 `ApiError`; a 409
// RATE_CARD_RATIFIED also cites the card hash (MM-4 prints it). Anything else is a transport failure.

import {
  type ApiCommandName,
  ApiError,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  RateCardRatifiedError,
} from "@fairsplit/contracts";

export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  readonly error: ApiError;
  readonly command: ApiCommandName;

  constructor(command: ApiCommandName, error: ApiError) {
    super(error.message);
    this.command = command;
    this.error = error;
  }

  get code(): ErrorCode {
    return this.error.code;
  }

  get status(): number {
    return this.error.status;
  }

  /** The 409 body that refuses an edit to the ratified card, with its hash, or null. */
  ratified(): RateCardRatifiedError | null {
    const parsed = RateCardRatifiedError.safeParse(this.error);
    return parsed.success ? parsed.data : null;
  }
}

/** The network failed, or the response was not what the contract says. */
export class TransportError extends Error {
  override readonly name = "TransportError";
  readonly command: ApiCommandName | null;
  readonly httpStatus: number | null;

  constructor(message: string, command: ApiCommandName | null, httpStatus: number | null = null) {
    super(message);
    this.command = command;
    this.httpStatus = httpStatus;
  }
}

export type CommandError = ApiRequestError | TransportError;

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

/**
 * What each refusal means, in the console's words (S1.11: say what happened and what to do; a hold is never an
 * "error"). Screens show these with the API's own message and the request ID beneath (CommandNotice).
 */
export const ERROR_WORDS: Readonly<Record<ErrorCode, string>> = {
  RATE_CARD_RATIFIED: "The rate card is ratified. Its rules don't change during the season.",
  RULES_BEFORE_FACTS: "Ratify the rate card before the first slip.",
  KILL_SWITCH_ON: "Paused by the co-op's kill switch.",
  DIGEST_MISMATCH: "The batch changed after it was signed. Nothing was sent.",
  APPROVALS_MISSING: "Both keys are needed first.",
  APPROVAL_EXPIRED: "The approval expired. Sign again.",
  NONCE_REUSED: "That approval was already used.",
  SIGNATURE_INVALID: "The signature didn't match the batch.",
  KEY_NOT_REGISTERED: "That key isn't registered for this approver.",
  APPROVER_MISMATCH: "That key belongs to someone else.",
  SIGNERS_NOT_DISTINCT: "Two people sign, with two keys.",
  SEASON_MISMATCH: "This approval was made for another season.",
  BLOCKING_HOLDS_OPEN: "Holds still need you before approval.",
  HOLD_NOT_OPEN: "This hold was already decided.",
  RESOLUTION_NOT_ALLOWED: "That decision doesn't apply to this hold.",
  INVALID_TRANSITION: "The run has moved on. Showing where it is now.",
  VERSION_CONFLICT: "This changed a moment ago. Showing the latest.",
  SANDBOX_GUARD: "Only the sandbox is allowed here.",
  QUEUED: "PayPal's sandbox is pacing us. You're in the queue.",
  CIRCUIT_OPEN: "PayPal asked us to slow down. PayPal steps replay, labelled.",
  RATE_LIMITED: "Too many tries at once. Wait a moment, then try again.",
  IDEMPOTENCY_KEY_REUSED: "That upload was already received.",
  CONTENT_DIGEST_MISMATCH: "The photo changed on the way. Send it again.",
  POLICY_DENIED: "Policy refused it.",
  PAYPAL_REJECTED: "PayPal rejected it.",
  PAYPAL_UNAVAILABLE: "PayPal didn't answer in time.",
  AI_LIVE_DISABLED: "Live slip reading is off. The recorded run still plays.",
  AI_BUDGET: "Today's live reading budget is spent.",
  VALIDATION_FAILED: "That doesn't fit what this step takes.",
  NOT_FOUND: "That isn't here any more.",
  UNAUTHENTICATED: "This run's session ended. Reset to start a fresh one.",
  FORBIDDEN: "That isn't allowed for this role.",
  FRAME_TOKEN_EXPIRED: "The phone's session expired. It gets a fresh one on its own.",
  PAIRING_TOKEN_INVALID: "That pairing code expired. Make a new one.",
  INTERNAL: "The server failed on this step. Nothing changed.",
};

/** Codes where PayPal is the actor: the only refusals that may show red (design §2.2). */
export const PAYPAL_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "PAYPAL_REJECTED",
  "PAYPAL_UNAVAILABLE",
]);

export interface ErrorView {
  /** The console's sentence for what happened. */
  readonly title: string;
  /** The API's own message, when it adds something. */
  readonly detail: string | null;
  /** "Request 01J…" and PayPal's debug ID, for the log and support. */
  readonly refs: readonly string[];
  /** PayPal refused or failed: the one case that is red. */
  readonly paypal: boolean;
  readonly code: ErrorCode | null;
}

/** Turns any failure from a command, query or stream into what a screen shows. */
export function errorView(error: unknown): ErrorView {
  if (isApiRequestError(error)) {
    const e = error.error;
    const refs: string[] = [];
    if (e.requestId) refs.push(`Request ${e.requestId}`);
    if (e.paypalDebugId) refs.push(`PayPal debug ID ${e.paypalDebugId}`);
    const title = ERROR_WORDS[e.code];
    return {
      title,
      detail: e.message && e.message !== title ? e.message : null,
      refs,
      paypal: PAYPAL_CODES.has(e.code),
      code: e.code,
    };
  }
  if (error instanceof TransportError) {
    return {
      title: "The connection failed. Nothing changed.",
      detail: error.message,
      refs: error.httpStatus ? [`HTTP ${error.httpStatus}`] : [],
      paypal: false,
      code: null,
    };
  }
  return {
    title: "This step failed. Nothing changed.",
    detail: error instanceof Error ? error.message : null,
    refs: [],
    paypal: false,
    code: null,
  };
}

/** Reads an error body: an `ApiError` (or a 409 with the card hash), else a generic one for its status. */
export function toApiError(status: number, body: unknown): ApiError {
  const ratified = RateCardRatifiedError.safeParse(body);
  if (ratified.success) return ratified.data;
  const parsed = ApiError.safeParse(body);
  if (parsed.success) return parsed.data;
  const code = statusToCode(status);
  return { code, status: ERROR_HTTP_STATUS[code], message: `The API answered ${status}.` };
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400) return "VALIDATION_FAILED";
  return "INTERNAL";
}
