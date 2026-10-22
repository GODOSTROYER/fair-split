/**
 * TEMPORARY SHIM: replace with @fairsplit/paypal-core (WS-PPCORE, merged into main on 23 Oct).
 *
 * IC-05 as written in register §11 and S3 §S3.6.2, and as WS-PPCORE built it
 * (packages/paypal-core/src/http.ts): each type here is a structural supertype of the real one, so
 * the real client plugs in unchanged and the swap is an import-path change. PayPalHttp takes the
 * limiter token, attaches PayPal-Request-Id, records `paypal_calls` and merges `details[].link` into
 * `links` (Payouts puts the original batch link there). The real client also retries idempotent calls
 * itself; money-moving POSTs pass `idempotent: false`, because PayoutsService owns their retries.
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
  /** Called on a 401; with the stale token, drops it only if it is still the cached one. */
  invalidate(staleToken?: string): void;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

/**
 * The real client's failure kinds: `limited`, `circuit_open`, `auth` and `invalid_request` were
 * refused locally and sent nothing (`delivery: "not_sent"`); `timeout` and `network` may have reached
 * PayPal (`unknown`); `http` is PayPal's own answer (`received`).
 */
export type PayPalFailureKind =
  | "http"
  | "timeout"
  | "network"
  | "limited"
  | "circuit_open"
  | "auth"
  | "invalid_request";

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
      /** Set by WS-PPCORE's client; a double may leave them out (then status 0 means no answer). */
      kind?: PayPalFailureKind;
      delivery?: "not_sent" | "unknown" | "received";
      retryAfterMs?: number | null;
    };

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH";
  /** Relative to the sandbox origin, e.g. "/v1/payments/payouts". */
  path: string;
  body?: unknown;
  requestId?: string;
  purpose: CallPurpose;
  priority: CallPriority;
  /** Whether the client may repeat the call itself; false for the POSTs PayoutsService retries. */
  idempotent?: boolean;
}

export interface PayPalHttp {
  request<T>(request: PayPalRequest): Promise<PayPalResult<T>>;
}
