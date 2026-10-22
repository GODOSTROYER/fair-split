import { describe, expect, it } from "vitest";
import { PAYPAL_API_HOSTS } from "../env.js";
import { checkCertUrl } from "./cert-url.js";

const sandbox = PAYPAL_API_HOSTS.sandbox;

describe("checkCertUrl", () => {
  it.each([
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d",
    "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
    "https://API.SANDBOX.PAYPAL.COM/v1/notifications/certs/CERT-1",
    "https://api.sandbox.paypal.com:443/v1/notifications/certs/CERT-1",
  ])("accepts %s", (url) => {
    const result = checkCertUrl(url, sandbox);
    expect(result.ok).toBe(true);
  });

  it("normalizes the cache key so case and the default port do not create new cache entries", () => {
    const a = checkCertUrl("https://API.sandbox.paypal.com:443/v1/notifications/certs/CERT-1", sandbox);
    const b = checkCertUrl("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", sandbox);
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
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?x=1", "HAS_QUERY_OR_FRAGMENT"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?", "HAS_QUERY_OR_FRAGMENT"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1#frag", "HAS_QUERY_OR_FRAGMENT"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/a/b", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/../../oauth2/token", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/%2e%2e/%2e%2e/oauth2/token", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT%2F..", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/oauth2/token", "BAD_PATH"],
  ])("rejects %j as %s", (url, reason) => {
    expect(checkCertUrl(url, sandbox)).toEqual({ ok: false, reason });
  });

  it("accepts live hosts only when the live allowlist is configured", () => {
    expect(
      checkCertUrl("https://api.paypal.com/v1/notifications/certs/CERT-1", PAYPAL_API_HOSTS.live).ok,
    ).toBe(true);
  });
});
