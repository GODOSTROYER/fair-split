// WS-PPCORE's real IC-05 client (`createPayPalHttp` from @fairsplit/paypal-core), pointed at msw's
// sandbox: every request crosses a real fetch, so the service is tested on the client production wires
// in (limiter gate, bearer token, PayPal-Request-Id, its own retries of idempotent calls, the 401
// refresh, links merged from details[].link). The token is fixed, the limiter never refuses and waits
// are skipped unless a test injects its own `auth`, `limiter` or `sleep`.

import {
  createPayPalHttp,
  type PayPalAuth,
  type PayPalHttp,
  type PayPalHttpConfig,
  type PayPalRequest,
  type PayPalResult,
  unlimitedLimiter,
} from "@fairsplit/paypal-core";

export const TEST_TOKEN = "test-token";

export interface FixedAuth extends Pick<PayPalAuth, "token" | "invalidate"> {
  /** The stale token passed to each invalidate() (the client's 401 handling). */
  readonly invalidated: (string | undefined)[];
}

/** The shared token cache, always handing out the same token. */
export function fixedAuth(): FixedAuth {
  const invalidated: (string | undefined)[] = [];
  return {
    invalidated,
    token: async () => ({ v: TEST_TOKEN, exp: Date.now() + 3_600_000, scopes: [], appId: null }),
    invalidate: (stale) => void invalidated.push(stale),
  };
}

/** The real client, recording each request the payouts code hands it. */
export class RealPayPalHttp implements PayPalHttp {
  readonly calls: PayPalRequest[] = [];
  readonly #client: PayPalHttp;

  constructor(config: Partial<Pick<PayPalHttpConfig, "auth" | "limiter" | "sleep">> = {}) {
    this.#client = createPayPalHttp({
      env: "sandbox",
      auth: config.auth ?? fixedAuth(),
      limiter: config.limiter ?? unlimitedLimiter,
      sleep: config.sleep ?? (async () => {}),
      timeoutMs: 2_000,
    });
  }

  request<T = unknown>(request: PayPalRequest): Promise<PayPalResult<T>> {
    this.calls.push(request);
    return this.#client.request<T>(request);
  }
}
