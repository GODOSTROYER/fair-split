// `paypal-cert-url` validation, before anything is fetched.
//
// Two layers (register §8 "a cert host on the allowlist", architecture §6.4, S3.6.5):
//   1. Structural, not configurable: https, default port, no credentials, query or fragment, a
//      paypal.com host (label boundary), and a path of exactly /v1/notifications/certs/<id> where
//      <id> has PayPal's shape CERT-xxxxxxxx-xxxxxxxx-xxxxxxxx (lowercase hex). Every PayPal cert id
//      seen in the wild has it (13 ids, 2015-2026, sandbox and live, checked 22 Oct 2026), e.g.
//      CERT-360caa42-fca2a594-bf9ab596, the sandbox signing certificate in use in Oct 2026.
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
/** PayPal's certificate id shape, e.g. CERT-360caa42-fca2a594-bf9ab596. */
export const CERT_ID_PATTERN = /^CERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/;
const CERT_PATH = /^\/v1\/notifications\/certs\/CERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/;

export type CertUrlCheck =
  /** `certId` (CERT-…) names the certificate whichever allowlisted host serves it. */
  { ok: true; url: URL; cacheKey: string; certId: string } | { ok: false; reason: CertUrlRejection };

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
  const certId = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  return { ok: true, url, cacheKey: `${url.origin}${url.pathname}`, certId };
}

/**
 * The simulator's cert id shape (packages/paypal-sim: `SIMCERT-` and the first 24 hex digits of its leaf's SHA-256
 * fingerprint). Never PayPal's: PayPal's ids are CERT-….
 */
export const SIMULATOR_CERT_ID_PATTERN = /^SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/;
const SIMULATOR_CERT_FILE = /\/(SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8})\.pem$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `paypal-cert-url` in PP_MODE=simulator only (ADR-0002, ADR-0010): the in-process simulator serves its chain at
 * `{host app}/paypal-sim/sim/certs/SIMCERT-….pem`, never on a PayPal host, so PayPal's structural check cannot
 * pass it. This check takes its place, and nothing else does: the URL must match `pattern` (the simulator's
 * `certUrlPattern`, built from the host app's own public URL) as a whole, use https (plain http only on a loopback
 * host, for local development), carry no credentials, query or fragment, and name a SIMCERT id. PayPal's own cert
 * URLs fail here (HOST_NOT_ALLOWED): a verifier in simulator mode trusts the simulator alone.
 */
export function checkSimulatorCertUrl(value: string, pattern: RegExp): CertUrlCheck {
  if (value.length === 0 || value.length > MAX_CERT_URL_LENGTH) return { ok: false, reason: "NOT_A_URL" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "NOT_A_URL" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return { ok: false, reason: "NOT_HTTPS" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "HAS_CREDENTIALS" };
  if (url.search !== "" || url.hash !== "" || value.includes("?") || value.includes("#")) {
    return { ok: false, reason: "HAS_QUERY_OR_FRAGMENT" };
  }
  // A fresh, anchored copy of the pattern: a global or sticky flag must never make this check stateful.
  if (!new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace(/[gy]/g, "")).test(value)) {
    return { ok: false, reason: "HOST_NOT_ALLOWED" };
  }
  const file = SIMULATOR_CERT_FILE.exec(url.pathname);
  if (!file?.[1]) return { ok: false, reason: "BAD_PATH" };
  return { ok: true, url, cacheKey: `${url.origin}${url.pathname}`, certId: file[1] };
}
