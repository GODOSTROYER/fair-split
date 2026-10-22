import { describe, expect, it } from "vitest";
import { PayPalScopeError } from "./errors.js";
import { assertScopes, checkScopes, PAYPAL_SCOPES } from "./scopes.js";

// The scope string from PayPal's own sample OAuth response (developer.paypal.com/api/rest/authentication).
const PAYPAL_SAMPLE_SCOPE =
  "https://uri.paypal.com/services/invoicing https://uri.paypal.com/services/disputes/read-buyer https://uri.paypal.com/services/payments/realtimepayment https://uri.paypal.com/services/disputes/update-seller https://uri.paypal.com/services/payments/payment/authcapture openid https://uri.paypal.com/services/disputes/read-seller https://uri.paypal.com/services/payments/refund https://api-m.paypal.com/v1/vault/credit-card https://api-m.paypal.com/v1/payments/.* https://uri.paypal.com/payments/payouts https://api-m.paypal.com/v1/vault/credit-card/.* https://uri.paypal.com/services/subscriptions https://uri.paypal.com/services/applications/webhooks".split(
    " ",
  );

describe("scope check at boot", () => {
  it("accepts PayPal's documented sample scope set and reports Transaction Search as lagging", () => {
    const report = checkScopes(PAYPAL_SAMPLE_SCOPE);
    expect(report.ok).toBe(true);
    expect(report.capabilities).toEqual({
      invoicing: "granted",
      payouts: "granted",
      webhooks: "granted",
      reportingSearch: "lagging",
      reportingBalances: "missing",
    });
  });

  it("uses the payouts scope without services/ (as PayPal issues it)", () => {
    expect(PAYPAL_SCOPES.payouts).toBe("https://uri.paypal.com/payments/payouts");
    expect(checkScopes(["https://uri.paypal.com/services/payments/payouts"]).capabilities.payouts).toBe(
      "missing",
    );
  });

  it("lets a parent scope cover a child, never the reverse", () => {
    expect(checkScopes(["https://uri.paypal.com/services/reporting"]).capabilities.reportingSearch).toBe(
      "granted",
    );
    expect(
      checkScopes(["https://uri.paypal.com/services/invoicing/invoices/read"]).capabilities.invoicing,
    ).toBe("missing");
    expect(checkScopes(["https://uri.paypal.com/services/invoicingx"]).capabilities.invoicing).toBe(
      "missing",
    );
  });

  it("throws a PayPalScopeError naming the missing scope URIs", () => {
    const err = (() => {
      try {
        assertScopes([PAYPAL_SCOPES.invoicing]);
      } catch (e) {
        return e as PayPalScopeError;
      }
      throw new Error("expected a throw");
    })();
    expect(err).toBeInstanceOf(PayPalScopeError);
    expect(err.missing).toEqual([PAYPAL_SCOPES.payouts, PAYPAL_SCOPES.webhooks]);
    expect(assertScopes(PAYPAL_SAMPLE_SCOPE).ok).toBe(true);
  });
});
