// `paypal-cert-url` validation, before anything is fetched.
//
// Two layers (register §8 "a cert host on the allowlist", architecture §6.4, S3.6.5):
//   1. Structural, not configurable: https, default port, no credentials, query or fragment, a
//      paypal.com host (label boundary), and a path of exactly /v1/notifications/certs/<id>.
//   2. Environment allowlist: in the sandbox only api.sandbox.paypal.com and api-m.sandbox.paypal.com.
// Rejecting query strings also stops cache-busting variants of a real cert URL, which would
// otherwise make us re-fetch from PayPal and spend the sandbox's per-IP request budget.

import { isPayPalHost } from "../env.js";

export type CertUrlRejection =
  | "NOT_A_URL"
  | "NOT_HTTPS"
  | "HAS_CREDENTIALS"
  | "NON_DEFAULT_PORT"
  | "HOST_NOT_PAYPAL"
  | "HOST_NOT_ALLOWED"
  | "HAS_QUERY_OR_FRAGMENT"
  | "BAD_PATH";

/** Max length per the verify-webhook-signature schema (`cert_url` maxLength 500). */
const MAX_CERT_URL_LENGTH = 500;
const CERT_PATH = /^\/v1\/notifications\/certs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type CertUrlCheck = { ok: true; url: URL; cacheKey: string } | { ok: false; reason: CertUrlRejection };

export function checkCertUrl(value: string, allowedHosts: readonly string[]): CertUrlCheck {
  if (value.length === 0 || value.length > MAX_CERT_URL_LENGTH) return { ok: false, reason: "NOT_A_URL" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "NOT_A_URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "NOT_HTTPS" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "HAS_CREDENTIALS" };
  if (url.port !== "") return { ok: false, reason: "NON_DEFAULT_PORT" };
  if (!isPayPalHost(url.hostname)) return { ok: false, reason: "HOST_NOT_PAYPAL" };
  if (!allowedHosts.includes(url.hostname)) return { ok: false, reason: "HOST_NOT_ALLOWED" };
  if (url.search !== "" || url.hash !== "" || value.includes("?") || value.includes("#")) {
    return { ok: false, reason: "HAS_QUERY_OR_FRAGMENT" };
  }
  if (!CERT_PATH.test(url.pathname)) return { ok: false, reason: "BAD_PATH" };
  return { ok: true, url, cacheKey: `${url.origin}${url.pathname}` };
}
