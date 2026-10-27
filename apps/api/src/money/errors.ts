// How a PayPal step failed, in the API's words. Every PayPal effect runs as an outbox task (I7); a task that
// fails for a reason a retry can fix (no answer, a 5xx, the 40/min window) is retried by the outbox with
// backoff, so the caller hears QUEUED with a retry hint. A 429 opens the 6-minute circuit (CIRCUIT_OPEN). A
// 4xx is PayPal's answer (PAYPAL_REJECTED, with its debug_id) and is never retried.
import { PayPalAuthError, PayPalHttpError } from "@fairsplit/paypal-core";
import { ToolkitArgsError, ToolkitError, ToolkitMethodError } from "@fairsplit/paypal-toolkit";

export type StepCode =
  | "PAYPAL_REJECTED"
  | "QUEUED"
  | "CIRCUIT_OPEN"
  | "KILL_SWITCH_ON"
  | "INVALID_TRANSITION";

/** A failed PayPal step, classified. `transient` steps are retried by the outbox. */
export class PayPalStepError extends Error {
  override readonly name = "PayPalStepError";
  constructor(
    readonly code: StepCode,
    message: string,
    readonly opts: {
      debugId?: string | null;
      retryAfterMs?: number;
      transient: boolean;
      status?: number | null;
    },
  ) {
    super(message);
  }
}

/** The 40/min window or the circuit refused a slot; nothing was sent. */
export class LaneRefused extends Error {
  override readonly name = "LaneRefused";
  constructor(
    readonly reason: "WINDOW_FULL" | "BACKGROUND_FULL" | "CIRCUIT_OPEN",
    readonly retryAfterMs: number,
  ) {
    super(`PayPal lane refused a slot (${reason})`);
  }
}

const CIRCUIT_MS = 6 * 60_000;

export function classifyPayPal(err: unknown, what: string): PayPalStepError {
  if (err instanceof PayPalStepError) return err;
  if (err instanceof LaneRefused) {
    return err.reason === "CIRCUIT_OPEN"
      ? new PayPalStepError(
          "CIRCUIT_OPEN",
          "PayPal's sandbox is pacing us; PayPal steps wait a few minutes.",
          {
            retryAfterMs: err.retryAfterMs,
            transient: true,
          },
        )
      : new PayPalStepError("QUEUED", "The live PayPal lane is busy; the step is queued.", {
          retryAfterMs: err.retryAfterMs,
          transient: true,
        });
  }
  if (err instanceof ToolkitError) {
    if (err.status === 429) {
      return new PayPalStepError(
        "CIRCUIT_OPEN",
        "PayPal's sandbox is pacing us; PayPal steps wait a few minutes.",
        {
          debugId: err.debugId,
          retryAfterMs: CIRCUIT_MS,
          transient: true,
          status: 429,
        },
      );
    }
    if (err.outcomeUnknown) {
      return new PayPalStepError("QUEUED", `PayPal did not answer ${what}; it will be retried.`, {
        debugId: err.debugId,
        retryAfterMs: 5_000,
        transient: true,
        status: err.status,
      });
    }
    return new PayPalStepError("PAYPAL_REJECTED", `PayPal refused ${what} (${err.code}).`, {
      debugId: err.debugId,
      transient: false,
      status: err.status,
    });
  }
  if (err instanceof PayPalHttpError) {
    if (err.status === 429) {
      return new PayPalStepError(
        "CIRCUIT_OPEN",
        "PayPal's sandbox is pacing us; PayPal steps wait a few minutes.",
        {
          debugId: err.debugId,
          retryAfterMs: CIRCUIT_MS,
          transient: true,
          status: 429,
        },
      );
    }
    if (err.status >= 400 && err.status < 500) {
      return new PayPalStepError("PAYPAL_REJECTED", `PayPal refused ${what} (${err.paypalName}).`, {
        debugId: err.debugId,
        transient: false,
        status: err.status,
      });
    }
    return new PayPalStepError("QUEUED", `PayPal did not answer ${what}; it will be retried.`, {
      debugId: err.debugId,
      retryAfterMs: 5_000,
      transient: true,
      status: err.status,
    });
  }
  if (err instanceof PayPalAuthError) {
    return new PayPalStepError("QUEUED", "PayPal sign-in failed; the step will be retried.", {
      retryAfterMs: 5_000,
      transient: true,
    });
  }
  if (err instanceof ToolkitArgsError || err instanceof ToolkitMethodError) {
    // Our own canonical body failed the toolkit's schema: a bug, never PayPal's fault; never retried.
    return new PayPalStepError(
      "PAYPAL_REJECTED",
      `The ${what} request was refused before sending (${err.message}).`,
      {
        transient: false,
      },
    );
  }
  return new PayPalStepError("QUEUED", `${what} failed; it will be retried.`, {
    retryAfterMs: 5_000,
    transient: true,
  });
}
