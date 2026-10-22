// Shared, dependency-free types for @fairsplit/paypal-core.

/** The subset of `fetch` this package needs. Injected in tests; defaults to the global at call time. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Resolve `globalThis.fetch` lazily, so interceptors installed after import (msw) still apply. */
export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** pino-compatible logger subset. Every method is optional; pass nothing to stay silent. */
export interface LoggerLike {
  debug?(obj: Record<string, unknown>, msg?: string): void;
  info?(obj: Record<string, unknown>, msg?: string): void;
  warn?(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

/** Fetch `Headers`, or Node's `IncomingHttpHeaders`-style record. Lookups are case-insensitive. */
export type HeadersLike = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

/** Read one header case-insensitively; repeated values are joined with ", " (RFC 9110). */
export function readHeader(headers: HeadersLike, name: string): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(
    headers as Record<string, string | readonly string[] | undefined>,
  )) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    return typeof value === "string" ? value : value.join(", ");
  }
  return null;
}

/** Priority lane for the shared limiter: live judges keep at least 20 calls a minute (S3.9). */
export type CallPriority = "live" | "background";

/**
 * Why a PayPal call is made. Recorded in `paypal_calls.purpose` (the limiter window) and on the
 * `paypal.call` span. `toolkit:*` is used by WS-PPMONEY's `tk()` runner.
 */
export type CallPurpose =
  | "oauth.token"
  | "webhooks.list"
  | "webhooks.create"
  | "webhooks.update"
  | "webhooks.lookup.list"
  | "webhooks.lookup.create"
  | "webhooks.verify"
  | "webhooks.cert"
  | "webhooks.events.list"
  | "webhooks.events.resend"
  | "invoices.get"
  | "payouts.create"
  | "payouts.get"
  | "payouts.item.get"
  | "payouts.item.cancel"
  | "reporting.search"
  | "reporting.balances"
  | "health"
  | `toolkit:${string}`;
