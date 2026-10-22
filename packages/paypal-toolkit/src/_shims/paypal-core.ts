/**
 * TEMPORARY SHIM: replace with @fairsplit/paypal-core after WS-PPCORE merges.
 *
 * Mirrors the parts of IC-05 (register §11, S3 §S3.6.2) that this package uses, with the same
 * names, so the swap is an import-path change. Shapes are structural supertypes of WS-PPCORE's draft
 * (ws/ppcore `auth.ts`, `limiter.ts`), so its real objects plug in unchanged. The toolkit path needs
 * only the shared token cache and the limiter: every execution goes through the toolkit's own
 * PayPalAPI (graft G1), never PayPalHttp.
 */

export type CallPriority = "live" | "background";

export interface PayPalToken {
  readonly v: string;
  readonly exp: number;
  readonly scopes: readonly string[];
}

export interface PayPalAuth {
  /** One per process; single-flight; refreshes 300 s before expiry. */
  token(): Promise<PayPalToken>;
  /** Called on a 401; with the stale token, drops it only if it is still the cached one. */
  invalidate(staleToken?: string): void;
}

/** IC-04 `limiter.take` as WS-PPCORE's draft returns it: a decision, never a silent pass. */
export type LimiterDecision =
  | { ok: true; ticket?: string }
  | { ok: false; reason: string; retryAfterMs: number };

export interface PayPalLimiter {
  /** 40 calls a minute across services, 20 at background priority, a 6-minute circuit after a 429. */
  take(request: { purpose: string; priority: CallPriority }): Promise<LimiterDecision>;
}

const PAYPAL_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

/**
 * S3 §S3.6.2 `ppDate`: PayPal's calendar date (America/Los_Angeles), yyyy-mm-dd. The only "today"
 * compared with a date PayPal holds: at 00:30 UTC the UTC date is already tomorrow in PayPal's eyes.
 */
export function ppDate(at: Date = new Date()): string {
  return PAYPAL_DATE.format(at);
}
