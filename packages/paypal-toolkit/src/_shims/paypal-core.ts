/**
 * TEMPORARY SHIM: replace with @fairsplit/paypal-core after WS-PPCORE merges.
 *
 * Mirrors the parts of IC-05 (register §11, S3 §S3.6.2) that this package uses, with the same
 * names and shapes, so the swap is an import-path change. The toolkit path needs only the shared
 * token cache: every execution goes through the toolkit's own PayPalAPI (graft G1), never
 * PayPalHttp.
 */

export type CallPriority = "live" | "background";

export interface PayPalToken {
  v: string;
  exp: number;
  scopes: string[];
}

export interface PayPalAuth {
  /** One per process; single-flight; refreshes 300 s before expiry. */
  token(): Promise<PayPalToken>;
  /** Called on a 401; the caller retries once. */
  invalidate(): void;
}
