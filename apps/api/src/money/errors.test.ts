import { PayPalHttpError } from "@fairsplit/paypal-core";
import { ToolkitError } from "@fairsplit/paypal-toolkit";
import { describe, expect, it } from "vitest";
import { classifyPayPal, LaneRefused } from "./errors.js";

describe("simulated sandbox pacing copy", () => {
  it.each([
    new LaneRefused("CIRCUIT_OPEN", 60_000),
    new ToolkitError({
      method: "record_payment_for_invoice",
      status: 429,
      code: "RATE_LIMIT_REACHED",
      message: "pacing",
      debugId: null,
      requestId: null,
      transportError: null,
    }),
    new PayPalHttpError({
      ok: false,
      kind: "http",
      status: 429,
      name: "RATE_LIMIT_REACHED",
      debugId: null,
      message: "pacing",
      details: [],
      links: [],
      retryable: true,
      retryAfterMs: 60_000,
      delivery: "received",
      ms: 1,
      attempts: 1,
      requestId: null,
    }),
  ])("inv.i8.pacing: labels the simulated rail for %s", (error) => {
    expect(classifyPayPal(error, "recordPayment")).toMatchObject({
      code: "CIRCUIT_OPEN",
      message: "The simulated PayPal sandbox is pacing us; PayPal steps wait a few minutes.",
      opts: { transient: true },
    });
  });
});
