// Token scope check at boot (architecture §6.1, S3.6.1). Scope URIs were checked on 22 Oct 2026
// against PayPal's OAuth sample response and the OpenAPI specs in paypal/paypal-rest-api-specifications:
// note that payouts is `https://uri.paypal.com/payments/payouts`, without `services/`.

import { PayPalScopeError } from "./errors.js";

export const PAYPAL_SCOPES = Object.freeze({
  invoicing: "https://uri.paypal.com/services/invoicing",
  payouts: "https://uri.paypal.com/payments/payouts",
  webhooks: "https://uri.paypal.com/services/applications/webhooks",
  reportingSearch: "https://uri.paypal.com/services/reporting/search/read",
  reportingBalances: "https://uri.paypal.com/services/reporting/balances/read",
} as const);

export type PayPalCapability = keyof typeof PAYPAL_SCOPES;

/**
 * - `granted`: the token carries the scope (or a broader parent scope).
 * - `missing`: it does not.
 * - `lagging`: Transaction Search is missing; PayPal takes about 9 h to propagate it, so it is
 *   reported, not fatal.
 */
export type CapabilityState = "granted" | "missing" | "lagging";

export interface ScopeReport {
  /** True when every required capability is granted. */
  ok: boolean;
  capabilities: Readonly<Record<PayPalCapability, CapabilityState>>;
  /** Required capabilities that are missing (boot fails on any). */
  missingRequired: readonly PayPalCapability[];
}

const REQUIRED: readonly PayPalCapability[] = ["invoicing", "payouts", "webhooks"];

/** A granted scope covers a required one if it is equal to it or a parent path of it. */
function covers(granted: readonly string[], required: string): boolean {
  return granted.some((g) => g === required || required.startsWith(`${g}/`));
}

/** Evaluate a token's space-separated scope list against Fair Split's needs. Pure. */
export function checkScopes(granted: readonly string[]): ScopeReport {
  const has = (c: PayPalCapability) => covers(granted, PAYPAL_SCOPES[c]);
  const capabilities: Record<PayPalCapability, CapabilityState> = {
    invoicing: has("invoicing") ? "granted" : "missing",
    payouts: has("payouts") ? "granted" : "missing",
    webhooks: has("webhooks") ? "granted" : "missing",
    reportingSearch: has("reportingSearch") ? "granted" : "lagging",
    reportingBalances: has("reportingBalances") ? "granted" : "missing",
  };
  const missingRequired = REQUIRED.filter((c) => capabilities[c] !== "granted");
  return { ok: missingRequired.length === 0, capabilities, missingRequired };
}

/** Throw `PayPalScopeError` naming the missing scopes when a required capability is absent. */
export function assertScopes(granted: readonly string[], required: readonly PayPalCapability[] = REQUIRED) {
  const report = checkScopes(granted);
  const missing = required.filter((c) => report.capabilities[c] !== "granted");
  if (missing.length > 0) {
    throw new PayPalScopeError(
      `PayPal token is missing required scopes: ${missing.join(", ")}. Enable them on the REST app.`,
      missing.map((c) => PAYPAL_SCOPES[c]),
    );
  }
  return report;
}
