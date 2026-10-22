import { describe, expect, it } from "vitest";
import { PAYPAL_API_HOSTS } from "../env.js";
import { checkCertUrl } from "./cert-url.js";

const sandbox = PAYPAL_API_HOSTS.sandbox;
const ID = "CERT-360caa42-fca2a594-bf9ab596";

describe("checkCertUrl", () => {
  it.each([
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d",
    "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a784-5edc0ebc",
    "https://API.SANDBOX.PAYPAL.COM/v1/notifications/certs/CERT-360caa42-fca2a594-90621ecd",
    "https://api.sandbox.paypal.com:443/v1/notifications/certs/CERT-360caa42-fca2a594-90621ecd",
  ])("accepts %s", (url) => {
    const result = checkCertUrl(url, sandbox);
    expect(result.ok).toBe(true);
  });

  it("normalizes the cache key so case and the default port do not create new cache entries", () => {
    const a = checkCertUrl(`https://API.sandbox.paypal.com:443/v1/notifications/certs/${ID}`, sandbox);
    const b = checkCertUrl(`https://api.sandbox.paypal.com/v1/notifications/certs/${ID}`, sandbox);
    expect(a.ok && b.ok && a.cacheKey === b.cacheKey).toBe(true);
  });

  it.each([
    ["", "NOT_A_URL"],
    ["not a url", "NOT_A_URL"],
    [`https://api.sandbox.paypal.com/v1/notifications/certs/${"A".repeat(500)}`, "NOT_A_URL"],
    ["http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "NOT_HTTPS"],
    ["ftp://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "NOT_HTTPS"],
    ["https://attacker@api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "HAS_CREDENTIALS"],
    ["https://api.sandbox.paypal.com:8443/v1/notifications/certs/CERT-1", "NON_DEFAULT_PORT"],
    ["https://evil.example.com/v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://evilpaypal.com/v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://paypal.com.evil.example.com/v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://api.sandbox.paypal.com.evil.example.com/v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://api.sandbox.paypal.com./v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://api.paypal.com/v1/notifications/certs/CERT-1", "HOST_NOT_ALLOWED"],
    ["https://api-m.paypal.com/v1/notifications/certs/CERT-1", "HOST_NOT_ALLOWED"],
    ["https://www.paypal.com/v1/notifications/certs/CERT-1", "HOST_NOT_ALLOWED"],
    [`https://api.sandbox.paypal.com/v1/notifications/certs/${ID}?x=1`, "HAS_QUERY_OR_FRAGMENT"],
    [`https://api.sandbox.paypal.com/v1/notifications/certs/${ID}?`, "HAS_QUERY_OR_FRAGMENT"],
    [`https://api.sandbox.paypal.com/v1/notifications/certs/${ID}#frag`, "HAS_QUERY_OR_FRAGMENT"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/a/b", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/../../oauth2/token", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/%2e%2e/%2e%2e/oauth2/token", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT%2F..", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/oauth2/token", "BAD_PATH"],
    // Only PayPal's id shape: CERT- and three groups of eight lowercase hex digits.
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360CAA42-FCA2A594-BF9AB596", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab59", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab5960", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab59g", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/cert-360caa42-fca2a594-bf9ab596", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596.pem", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fairsplit-test-0001", "BAD_PATH"],
  ])("rejects %j as %s", (url, reason) => {
    expect(checkCertUrl(url, sandbox)).toEqual({ ok: false, reason });
  });

  it("accepts live hosts only when the live allowlist is configured", () => {
    expect(
      checkCertUrl(
        "https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-f826724b",
        PAYPAL_API_HOSTS.live,
      ).ok,
    ).toBe(true);
  });
});
