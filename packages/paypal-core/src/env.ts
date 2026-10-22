// PayPal environments and the hosts we trust in each.
//
// Fair Split runs on the sandbox only (register §8, S3.6.2: "Boot refuses to start unless
// PP_ENV=sandbox"). The live constants exist so the webhook verifier can be exercised against
// PayPal's published live certificates; the money-moving factories refuse `live` unless a caller
// opts in explicitly.

export type PayPalEnv = "sandbox" | "live";

/** REST API base URLs. Sandbox is https://api-m.sandbox.paypal.com (register §8). */
export const PAYPAL_API_BASE_URL: Readonly<Record<PayPalEnv, string>> = Object.freeze({
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
});

/**
 * API hosts PayPal uses for this environment. HATEOAS links (e.g. the "already exists" batch link in
 * `details[].link`) and `paypal-cert-url` headers use `api.sandbox.paypal.com`; the docs use `api-m`.
 */
export const PAYPAL_API_HOSTS: Readonly<Record<PayPalEnv, readonly string[]>> = Object.freeze({
  sandbox: Object.freeze(["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"]),
  live: Object.freeze(["api-m.paypal.com", "api.paypal.com"]),
});

/**
 * Subject (SAN dNSName) of PayPal's webhook message-verification certificate. Checked against the
 * certificates PayPal serves from /v1/notifications/certs/ (2019–2025 sandbox and live certs).
 */
export const PAYPAL_CERT_SUBJECTS: Readonly<Record<PayPalEnv, readonly string[]>> = Object.freeze({
  sandbox: Object.freeze(["messageverificationcerts.sandbox.paypal.com"]),
  live: Object.freeze(["messageverificationcerts.paypal.com"]),
});

/** True for `paypal.com` and its subdomains, with a label boundary (so `evilpaypal.com` is false). */
export function isPayPalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "paypal.com" || host.endsWith(".paypal.com");
}
