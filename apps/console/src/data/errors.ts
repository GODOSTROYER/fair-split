// Errors a command can end in, from @fairsplit/api-client (IC-08): the API answered an IC-01 `ApiError`
// (`ApiClientError`, its `code` narrowed to what that command may answer), the request got no answer
// (`NetworkError`), or the answer broke the contract (`ContractError`). A 409 RATE_CARD_RATIFIED also cites the
// card hash (MM-4 prints it): `asRateCardRatified(e)`. Screens show any of them through `errorView`.

import {
  ApiClientError,
  type ClientFailure,
  type CommandErrorCode,
  ContractError,
  isApiClientError,
  NetworkError,
} from "@fairsplit/api-client";
import type { ErrorCode } from "@fairsplit/contracts";
import type { CallableName } from "./adapter.js";

export {
  ApiClientError,
  asRateCardRatified,
  type ClientFailure,
  ContractError,
  isApiClientError,
  isContractError,
  isNetworkError,
  isNotImplemented,
  NetworkError,
} from "@fairsplit/api-client";

/** What command N can fail with: `error.code` is narrowed to the codes N may answer (IC-01 plus boundary codes). */
export type CommandError<N extends CallableName = CallableName> = ClientFailure<CommandErrorCode<N>>;

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
  FRAME_TOKEN_EXPIRED: "This session's credential lapsed. It renews on its own: try again in a moment.",
  PAIRING_TOKEN_INVALID: "That pairing code expired. Make a new one.",
  INTERNAL: "The server failed on this step. Nothing changed.",
};

/** A registered command whose API slice has not landed yet (501): said plainly, never as a failure. */
export const NOT_BUILT_WORDS = "This step isn't wired on the server yet. Nothing changed.";

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

/** The request ID of any failure that has one (for "Request 01J…" lines), else null. */
export function requestIdOf(error: unknown): string | null {
  if (error instanceof ApiClientError || error instanceof ContractError) return error.requestId;
  return null;
}

/** Turns any failure from a command, query or stream into what a screen shows. */
export function errorView(error: unknown): ErrorView {
  if (isApiClientError(error)) {
    const refs: string[] = [];
    if (error.requestId) refs.push(`Request ${error.requestId}`);
    if (error.paypalDebugId) refs.push(`PayPal debug ID ${error.paypalDebugId}`);
    const title = error.notImplemented ? NOT_BUILT_WORDS : ERROR_WORDS[error.code];
    return {
      title,
      detail: error.message && error.message !== title ? error.message : null,
      refs,
      paypal: PAYPAL_CODES.has(error.code),
      code: error.code,
    };
  }
  if (error instanceof NetworkError) {
    return {
      title: error.aborted
        ? "The step was cancelled. Nothing changed."
        : "The connection failed. Nothing changed.",
      detail: null,
      refs: [],
      paypal: false,
      code: null,
    };
  }
  if (error instanceof ContractError) {
    const refs = [`HTTP ${error.status}`];
    if (error.requestId) refs.unshift(`Request ${error.requestId}`);
    return {
      title: "The server answered in a shape this console doesn't know. Nothing changed.",
      detail: error.message,
      refs,
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
