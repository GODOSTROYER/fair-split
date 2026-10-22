// A fetch-based IC-05 PayPalHttp test double, built to the contract in S3 §S3.6.2: bearer token,
// PayPal-Request-Id when given, the paypal-debug-id header, and `links` merged from the top level
// and every `details[].link` (Payouts puts the original batch link there). Transport failures throw.
// The production implementation is WS-PPCORE's; this double only stands in for it in tests.

import type { PayPalHttp, PayPalLink, PayPalRequest, PayPalResult } from "../../src/index.js";
import { SANDBOX } from "./msw.js";

export class FetchPayPalHttp implements PayPalHttp {
  readonly calls: PayPalRequest[] = [];

  constructor(
    private readonly token = "test-token",
    private readonly timeoutMs = 2_000,
  ) {}

  async request<T>(r: PayPalRequest): Promise<PayPalResult<T>> {
    this.calls.push(r);
    const started = performance.now();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
    };
    if (r.requestId) headers["paypal-request-id"] = r.requestId;
    const res = await fetch(`${SANDBOX}${r.path}`, {
      method: r.method,
      headers,
      ...(r.body === undefined ? {} : { body: JSON.stringify(r.body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    const debugId = res.headers.get("paypal-debug-id");
    const ms = Math.round(performance.now() - started);
    if (res.ok) return { ok: true, status: res.status, body: body as T, debugId, ms };
    const err = (body ?? {}) as {
      name?: string;
      message?: string;
      details?: unknown[];
      links?: PayPalLink[];
    };
    const details = Array.isArray(err.details) ? err.details : [];
    const links: PayPalLink[] = [...(Array.isArray(err.links) ? err.links : [])];
    for (const d of details) {
      const link = (d as { link?: unknown }).link;
      if (Array.isArray(link)) links.push(...(link as PayPalLink[]));
    }
    return {
      ok: false,
      status: res.status,
      name: err.name ?? "HTTP_ERROR",
      message: err.message ?? "",
      details,
      links,
      debugId,
      retryable: res.status >= 500,
      ms,
    };
  }
}
