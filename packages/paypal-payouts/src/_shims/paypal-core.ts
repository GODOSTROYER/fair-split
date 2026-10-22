/**
 * TEMPORARY SHIM: replace with @fairsplit/paypal-core after WS-PPCORE merges.
 *
 * IC-05 as written in register §11 and S3 §S3.6.2, with the same names and shapes, so the swap is
 * an import-path change. PayPalHttp takes the limiter token, attaches PayPal-Request-Id, records
 * `paypal_calls` and merges `details[].link` into `links` (Payouts puts the original batch link
 * there); this package relies on that contract and nothing more.
 */

export type CallPriority = "live" | "background";

/** e.g. "payouts.create", "payouts.cancel" (free text in `paypal_calls.purpose`). */
export type CallPurpose = string;

export interface PayPalToken {
  v: string;
  exp: number;
  scopes: string[];
}

export interface PayPalAuth {
  token(): Promise<PayPalToken>;
  /** Called on a 401; the caller retries once. */
  invalidate(): void;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method: string;
}

export type PayPalResult<T> =
  | { ok: true; status: number; body: T; debugId: string | null; ms: number }
  | {
      ok: false;
      status: number;
      name: string;
      message: string;
      details: unknown[];
      links: PayPalLink[];
      debugId: string | null;
      retryable: boolean;
      ms: number;
    };

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH";
  /** Relative to the sandbox origin, e.g. "/v1/payments/payouts". */
  path: string;
  body?: unknown;
  requestId?: string;
  purpose: CallPurpose;
  priority: CallPriority;
}

export interface PayPalHttp {
  request<T>(request: PayPalRequest): Promise<PayPalResult<T>>;
}
