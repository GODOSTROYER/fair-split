// Error mapping: whatever a handler throws becomes an IC-01 `ApiError` with the right HTTP status.
//
//   ApiProblem                      → as given (code, status, retryAfterMs → Retry-After)
//   FairSplitDbError (SQL triggers) → RATE_CARD_RATIFIED 409 citing the hash (MM-4), RULES_BEFORE_FACTS 422,
//                                     ITEM_STATUS_REGRESSION / RETURN_WITHOUT_CANCEL → INVALID_TRANSITION 409,
//                                     the rest (append-only, ledger fork, purge, frozen column) → INTERNAL
//   NotFoundError (scoped repos)    → NOT_FOUND 404 (an id outside the caller's workspace looks absent)
//   serialization failure/deadlock  → VERSION_CONFLICT 409 (retry)
//   PayPalHttpError                 → PAYPAL_REJECTED 502 (4xx) | CIRCUIT_OPEN 503 (429) | PAYPAL_UNAVAILABLE 502,
//                                     with PayPal's debug_id
//   Hono HTTPException              → by status
//   anything else                   → INTERNAL 500; the message is logged, never sent.
import { asDbError, isSerializationFailure, NotFoundError } from "@fairsplit/db";
import { PayPalHttpError } from "@fairsplit/paypal-core";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";

/** Six minutes: our PayPal circuit after a 429 (register §8). */
const CIRCUIT_MS = 6 * 60_000;

export function toApiProblem(err: unknown): ApiProblem {
  if (err instanceof ApiProblem) return err;
  const db = asDbError(err);
  if (db) {
    switch (db.code) {
      case "RATE_CARD_RATIFIED":
        // The trigger knows only the hash; a handler that knows the card throws `problem.rateCardRatified()`
        // with the full RateCardRatifiedError shape instead.
        return new ApiProblem(
          "RATE_CARD_RATIFIED",
          "The rate card is ratified and bolted; it cannot change.",
          {
            fields: { hash: db.subject },
            details: { hash: db.subject },
            cause: err,
          },
        );
      case "RULES_BEFORE_FACTS":
        return new ApiProblem(
          "RULES_BEFORE_FACTS",
          "Rules come before facts: this slip predates ratification.",
          {
            details: { subject: db.subject },
            cause: err,
          },
        );
      case "ITEM_STATUS_REGRESSION":
      case "RETURN_WITHOUT_CANCEL":
        return new ApiProblem("INVALID_TRANSITION", "That state change is not allowed.", {
          details: { rule: db.code },
          cause: err,
        });
      default:
        return problem.internal("An integrity rule refused the write.", err);
    }
  }
  if (err instanceof NotFoundError) return problem.notFound(`${err.table} not found`);
  if (isSerializationFailure(err)) {
    return new ApiProblem(
      "VERSION_CONFLICT",
      "Someone changed this at the same moment. Reload and try again.",
      {
        cause: err,
      },
    );
  }
  if (err instanceof PayPalHttpError) {
    const debug = err.debugId ? { paypalDebugId: err.debugId } : {};
    if (err.status === 429) {
      return new ApiProblem(
        "CIRCUIT_OPEN",
        "PayPal's sandbox is pacing us. PayPal steps replay for a few minutes.",
        {
          retryAfterMs: CIRCUIT_MS,
          ...debug,
          cause: err,
        },
      );
    }
    if (err.status >= 400 && err.status < 500) {
      return new ApiProblem("PAYPAL_REJECTED", `PayPal refused the request (${err.paypalName}).`, {
        ...debug,
        cause: err,
      });
    }
    return new ApiProblem("PAYPAL_UNAVAILABLE", "PayPal did not answer. Nothing was changed.", {
      ...debug,
      cause: err,
    });
  }
  if (err instanceof HTTPException) {
    const s = err.status;
    if (s === 401) return problem.unauthenticated();
    if (s === 403) return problem.forbidden();
    if (s === 404) return problem.notFound();
    if (s === 413) return problem.validation("The request body is too large.");
    if (s >= 400 && s < 500) return problem.validation(err.message || "Bad request.");
    return problem.internal(undefined, err);
  }
  return problem.internal(undefined, err);
}

export function sendProblem(c: Context<AppEnv>, p: ApiProblem): Response {
  const requestId = c.get("requestId");
  if (p.extra.retryAfterMs !== undefined)
    c.header("Retry-After", String(Math.max(1, Math.ceil(p.extra.retryAfterMs / 1000))));
  return c.json(p.toBody(requestId), p.status as 400);
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const p = toApiProblem(err);
  const log = c.get("log");
  if (p.status >= 500 && p.status !== 501 && p.status !== 502 && p.status !== 503) {
    log?.error({ err, code: p.code }, "unhandled error");
  } else if (p.status >= 500) {
    log?.warn({ code: p.code, status: p.status, message: p.message }, "upstream or unimplemented");
  }
  return sendProblem(c, p);
};

/** Unknown API routes answer an ApiError; the SPA fallback (static.ts) handles everything else first. */
export const onNotFound: NotFoundHandler<AppEnv> = (c) =>
  sendProblem(c, problem.notFound(`No route for ${c.req.method} ${c.req.path}`));
