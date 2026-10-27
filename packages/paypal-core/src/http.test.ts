import { HttpResponse, http } from "msw/http";
import { describe, expect, it } from "vitest";
import { createPayPalAuth } from "./auth.js";
import { PayPalConfigError, PayPalHttpError } from "./errors.js";
import { createPayPalHttp, expectOk, type PayPalHttpConfig, parsePayPalError } from "./http.js";
import { createMemoryLimiter, type PayPalLimiter, unlimitedLimiter } from "./limiter.js";
import type { PayPalCallRecord } from "./recorder.js";
import {
  manualClock,
  oauthHandler,
  recordingSleep,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "./test-support.js";

useMswServer();

function setup(extra: Partial<PayPalHttpConfig> & { limiter?: PayPalLimiter } = {}) {
  const oauth = oauthHandler();
  server.use(oauth.handler);
  const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
  const sleeper = recordingSleep();
  const records: PayPalCallRecord[] = [];
  const client = createPayPalHttp({
    auth,
    limiter: unlimitedLimiter,
    sleep: sleeper.sleep,
    recorder: { record: (r) => void records.push(r) },
    ...extra,
  });
  return { client, oauth: oauth.stub, delays: sleeper.delays, records, auth };
}

const ALREADY_EXISTS = {
  name: "USER_BUSINESS_ERROR",
  message: "User business error.",
  debug_id: "f05063556a338",
  information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  details: [
    {
      field: "SENDER_BATCH_ID",
      issue: "Batch with given sender_batch_id already exists",
      link: [
        {
          href: "https://api.sandbox.paypal.com/v1/payments/payouts/CR9VS2K4X4846",
          rel: "self",
          method: "GET",
        },
      ],
    },
  ],
  links: [],
};

describe("PayPalHttp.request", () => {
  it("returns ok with the body and the paypal-debug-id header", async () => {
    const { client } = setup();
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tok-1");
        expect(request.headers.get("accept")).toBe("application/json");
        expect(new URL(request.url).searchParams.get("page_size")).toBe("100");
        return HttpResponse.json(
          { batch_header: { payout_batch_id: "B1" } },
          { headers: { "paypal-debug-id": "dbg-1" } },
        );
      }),
    );
    const result = await client.request<{ batch_header: { payout_batch_id: string } }>({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      query: { page_size: 100, total_required: true, skip: undefined },
      purpose: "payouts.get",
      priority: "live",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.batch_header.payout_batch_id).toBe("B1");
    expect(result.debugId).toBe("dbg-1");
    expect(result.attempts).toBe(1);
  });

  it("sends JSON bodies and PayPal-Request-Id", async () => {
    const { client } = setup();
    let seen: { id: string | null; type: string | null; body: unknown } | null = null;
    server.use(
      http.post(`${SANDBOX}/v1/payments/payouts`, async ({ request }) => {
        seen = {
          id: request.headers.get("paypal-request-id"),
          type: request.headers.get("content-type"),
          body: await request.json(),
        };
        return HttpResponse.json({ batch_header: { payout_batch_id: "B9" } }, { status: 201 });
      }),
    );
    const result = await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      body: { sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37" } },
      requestId: "a".repeat(64),
      purpose: "payouts.create",
      priority: "live",
    });
    expect(result.ok && result.status).toBe(201);
    expect(seen).toEqual({
      id: "a".repeat(64),
      type: "application/json",
      body: { sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37" } },
    });
  });

  it("sends rawJsonBody byte-for-byte", async () => {
    const { client } = setup();
    const raw = '{"z":1,  "a":[ 2 ,3 ]}';
    let received = "";
    server.use(
      http.post(`${SANDBOX}/v1/notifications/verify-webhook-signature`, async ({ request }) => {
        received = await request.text();
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    await client.request({
      method: "POST",
      path: "/v1/notifications/verify-webhook-signature",
      rawJsonBody: raw,
      purpose: "webhooks.verify",
      priority: "live",
    });
    expect(received).toBe(raw);
  });

  it("follows an absolute HATEOAS link on api.sandbox.paypal.com through the configured base URL", async () => {
    const { client } = setup();
    server.use(http.get(`${SANDBOX}/v1/payments/payouts/CR9VS2K4X4846`, () => HttpResponse.json({ ok: 1 })));
    const result = await client.request({
      method: "GET",
      path: "https://api.sandbox.paypal.com/v1/payments/payouts/CR9VS2K4X4846",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    "https://evil.example.com/v1/payments/payouts/X",
    "https://api.paypal.com/v1/payments/payouts/X",
    "http://api.sandbox.paypal.com/v1/payments/payouts/X",
    "https://api.sandbox.paypal.com:8443/v1/payments/payouts/X",
    "//evil.example.com/v1/x",
    "/oauth2/token",
    "v1/payments/payouts",
  ])("refuses %s before taking a token, so the bearer token never leaves PayPal", async (path) => {
    const { client, oauth } = setup();
    const result = await client.request({ method: "GET", path, purpose: "payouts.get", priority: "live" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    expect(result.delivery).toBe("not_sent");
    expect(oauth.calls).toBe(0);
  });

  it("refuses a malformed PayPal-Request-Id", async () => {
    const { client } = setup();
    const result = await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      requestId: "has space",
      purpose: "payouts.create",
      priority: "live",
    });
    expect(!result.ok && result.kind).toBe("invalid_request");
  });

  it("merges details[].link into links and keeps debug_id (the 'already exists' adopt path)", async () => {
    const { client } = setup();
    server.use(
      http.post(`${SANDBOX}/v1/payments/payouts`, () => HttpResponse.json(ALREADY_EXISTS, { status: 400 })),
    );
    const result = await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      body: {},
      requestId: "r-1",
      purpose: "payouts.create",
      priority: "live",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({
      kind: "http",
      status: 400,
      name: "USER_BUSINESS_ERROR",
      debugId: "f05063556a338",
      retryable: false,
      delivery: "received",
      requestId: "r-1",
    });
    expect(result.links).toEqual([
      {
        href: "https://api.sandbox.paypal.com/v1/payments/payouts/CR9VS2K4X4846",
        rel: "self",
        method: "GET",
      },
    ]);
    expect(result.details[0]?.issue).toBe("Batch with given sender_batch_id already exists");
  });

  it("refreshes the token once on 401 and retries", async () => {
    const { client, oauth } = setup();
    let calls = 0;
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts-item/I1`, ({ request }) => {
        calls += 1;
        if (request.headers.get("authorization") === "Bearer tok-1") {
          return HttpResponse.json(
            { error: "invalid_token", error_description: "Token signature verification failed" },
            { status: 401 },
          );
        }
        return HttpResponse.json({ payout_item_id: "I1" });
      }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts-item/I1",
      purpose: "payouts.item.get",
      priority: "live",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(oauth.calls).toBe(2);
  });

  it("gives up after one 401 refresh and reports the OAuth-style error", async () => {
    const { client } = setup();
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts-item/I1`, () =>
        HttpResponse.json(
          { error: "invalid_token", error_description: "Access Token not found in cache" },
          { status: 401 },
        ),
      ),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts-item/I1",
      purpose: "payouts.item.get",
      priority: "live",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({ status: 401, name: "invalid_token", attempts: 2 });
  });

  it("retries idempotent calls on 5xx at 1 s, 3 s and 9 s with the same request id", async () => {
    const { client, delays, records } = setup();
    const ids: (string | null)[] = [];
    server.use(
      http.post(`${SANDBOX}/v1/payments/payouts`, ({ request }) => {
        ids.push(request.headers.get("paypal-request-id"));
        return ids.length < 4
          ? HttpResponse.json({ name: "INTERNAL_SERVER_ERROR", debug_id: `d${ids.length}` }, { status: 503 })
          : HttpResponse.json({ batch_header: {} }, { status: 201 });
      }),
    );
    const result = await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      body: {},
      requestId: "sha-of-batch",
      purpose: "payouts.create",
      priority: "live",
    });
    expect(result.ok).toBe(true);
    expect(delays).toEqual([1000, 3000, 9000]);
    expect(ids).toEqual(["sha-of-batch", "sha-of-batch", "sha-of-batch", "sha-of-batch"]);
    expect(records.map((r) => r.status)).toEqual([503, 503, 503, 201]);
    expect(records.map((r) => r.attempt)).toEqual([1, 2, 3, 4]);
  });

  it("returns the last 5xx once the retry budget is spent", async () => {
    const { client, delays } = setup();
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, () =>
        HttpResponse.text("<html>bad gateway</html>", { status: 502 }),
      ),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({
      kind: "http",
      status: 502,
      name: "HTTP_502",
      retryable: true,
      attempts: 4,
    });
    expect(delays).toEqual([1000, 3000, 9000]);
  });

  it("never retries a non-idempotent POST", async () => {
    const { client, delays } = setup();
    let calls = 0;
    server.use(
      http.post(`${SANDBOX}/v1/notifications/webhooks`, () => {
        calls += 1;
        return HttpResponse.json({ name: "INTERNAL_SERVER_ERROR" }, { status: 500 });
      }),
    );
    const result = await client.request({
      method: "POST",
      path: "/v1/notifications/webhooks",
      body: {},
      purpose: "webhooks.create",
      priority: "background",
    });
    expect(!result.ok && result.status).toBe(500);
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("sends nothing once the caller's signal is aborted (FS_ABORTED, delivery not_sent)", async () => {
    const { client, records } = setup();
    let calls = 0;
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
      signal: AbortSignal.abort(),
    });
    expect(result).toMatchObject({ ok: false, kind: "timeout", name: "FS_ABORTED", delivery: "not_sent" });
    expect(calls).toBe(0);
    expect(records).toEqual([]);
  });

  it("cancels the attempt in flight when the caller's deadline passes (delivery unknown, no retry)", async () => {
    const { client, delays, records } = setup();
    let calls = 0;
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return HttpResponse.json({});
      }),
    );
    const started = performance.now();
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
      signal: AbortSignal.timeout(80),
    });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ ok: false, kind: "timeout", name: "FS_ABORTED", delivery: "unknown" });
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
    expect(records.map((r) => r.outcome)).toEqual(["timeout"]);
  });

  it("stops retrying when the caller aborts during a retry wait", async () => {
    const controller = new AbortController();
    let calls = 0;
    const { client } = setup({
      sleep: async () => {
        controller.abort();
      },
    });
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, () => {
        calls += 1;
        return HttpResponse.json({ name: "INTERNAL_SERVER_ERROR" }, { status: 503 });
      }),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, name: "FS_ABORTED", attempts: 1, delivery: "received" });
    expect(calls).toBe(1);
  });

  it("honours Retry-After on a retried 503, capped at 30 s", async () => {
    const { client, delays } = setup();
    let calls = 0;
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { name: "SERVICE_UNAVAILABLE" },
              { status: 503, headers: { "retry-after": "7" } },
            )
          : calls === 2
            ? HttpResponse.json(
                { name: "SERVICE_UNAVAILABLE" },
                { status: 503, headers: { "retry-after": "120" } },
              )
            : HttpResponse.json({});
      }),
    );
    await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(delays).toEqual([7000, 30_000]);
  });

  it("marks timeouts as delivery 'unknown' and retries them only when idempotent", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const oauth = oauthHandler();
    server.use(oauth.handler);
    const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
    const sleeper = recordingSleep();
    let attempts = 0;
    const client = createPayPalHttp({
      auth,
      limiter: unlimitedLimiter,
      sleep: sleeper.sleep,
      fetch: async () => {
        attempts += 1;
        throw timeout;
      },
    });
    const post = await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      body: {},
      purpose: "payouts.create",
      priority: "live",
    });
    expect(post).toMatchObject({
      ok: false,
      kind: "timeout",
      status: 0,
      delivery: "unknown",
      retryable: false,
      debugId: null,
    });
    expect(attempts).toBe(1);
    const get = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(get).toMatchObject({ ok: false, kind: "timeout", retryable: true, attempts: 4 });
    expect(attempts).toBe(5);
  });

  it("opens the 6-minute circuit on 429; later calls are refused without being sent", async () => {
    const clock = manualClock();
    const limiter = createMemoryLimiter({ now: clock.now });
    const { client } = setup({ limiter, now: clock.now });
    let calls = 0;
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/B1`, () => {
        calls += 1;
        return HttpResponse.json(
          { name: "RATE_LIMIT_REACHED", message: "Too many requests" },
          { status: 429 },
        );
      }),
    );
    const first = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(first).toMatchObject({
      ok: false,
      kind: "http",
      status: 429,
      name: "RATE_LIMIT_REACHED",
      retryable: true,
      retryAfterMs: 360_000,
    });
    expect(calls).toBe(1);
    clock.advance(5 * 60_000);
    const second = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(second).toMatchObject({
      ok: false,
      kind: "circuit_open",
      delivery: "not_sent",
      retryAfterMs: 60_000,
    });
    expect(calls).toBe(1);
    clock.advance(60_000);
    server.use(http.get(`${SANDBOX}/v1/payments/payouts/B1`, () => HttpResponse.json({})));
    expect(
      (
        await client.request({
          method: "GET",
          path: "/v1/payments/payouts/B1",
          purpose: "payouts.get",
          priority: "live",
        })
      ).ok,
    ).toBe(true);
  });

  it("returns 'limited' with retryAfterMs when the limiter denies, without sending", async () => {
    const limiter: PayPalLimiter = {
      take: async () => ({ ok: false, reason: "WINDOW_FULL", retryAfterMs: 40_000 }),
    };
    const { client, oauth } = setup({ limiter });
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "background",
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "limited",
      name: "FS_LIMITER_DENIED",
      delivery: "not_sent",
      retryAfterMs: 40_000,
    });
    expect(oauth.calls).toBe(0);
  });

  it("returns 'auth' when no token can be obtained", async () => {
    server.use(oauthHandler({ status: 401 }).handler);
    const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
    const client = createPayPalHttp({ auth, limiter: unlimitedLimiter });
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "auth",
      name: "FS_AUTH_FAILED",
      status: 401,
      delivery: "not_sent",
      retryable: false,
    });
  });

  it("records one row per attempt with the path but not the query string", async () => {
    const { client, records } = setup();
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks-events`, () =>
        HttpResponse.json({ events: [] }, { headers: { "paypal-debug-id": "dbg-ev" } }),
      ),
    );
    await client.request({
      method: "GET",
      path: "/v1/notifications/webhooks-events?start_time=2026-10-29T00:00:00Z",
      purpose: "webhooks.events.list",
      priority: "background",
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      purpose: "webhooks.events.list",
      priority: "background",
      method: "GET",
      path: "/v1/notifications/webhooks-events",
      status: 200,
      outcome: "ok",
      debugId: "dbg-ev",
      attempt: 1,
    });
  });

  it("keeps working when the recorder throws", async () => {
    const { client } = setup({ recorder: { record: () => Promise.reject(new Error("db down")) } });
    server.use(http.get(`${SANDBOX}/v1/payments/payouts/B1`, () => HttpResponse.json({ ok: true })));
    expect(
      (
        await client.request({
          method: "GET",
          path: "/v1/payments/payouts/B1",
          purpose: "payouts.get",
          priority: "live",
        })
      ).ok,
    ).toBe(true);
  });

  it("expectOk returns the body or throws a typed PayPalHttpError", async () => {
    const { client } = setup();
    server.use(
      http.get(`${SANDBOX}/v1/payments/payouts/NOPE`, () =>
        HttpResponse.json({ name: "INVALID_RESOURCE_ID", debug_id: "dbg-404" }, { status: 404 }),
      ),
    );
    const result = await client.request({
      method: "GET",
      path: "/v1/payments/payouts/NOPE",
      purpose: "payouts.get",
      priority: "live",
    });
    const err = (() => {
      try {
        expectOk(result);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(PayPalHttpError);
    expect(err).toMatchObject({ status: 404, paypalName: "INVALID_RESOURCE_ID", debugId: "dbg-404" });
  });

  it("is sandbox-only", () => {
    const auth = {
      token: async () => ({ v: "x", exp: 0, scopes: [], appId: null }),
      invalidate: () => undefined,
    };
    expect(() => createPayPalHttp({ auth, limiter: unlimitedLimiter, env: "live" })).toThrow(
      PayPalConfigError,
    );
  });
});

describe("parsePayPalError", () => {
  it("falls back to HTTP_<status> for bodies that are not PayPal errors", () => {
    expect(parsePayPalError(502, "<html>")).toMatchObject({
      name: "HTTP_502",
      message: "HTTP 502",
      links: [],
    });
    expect(parsePayPalError(500, undefined).name).toBe("HTTP_500");
  });

  it("deduplicates links and accepts a single link object in details", () => {
    const parsed = parsePayPalError(400, {
      name: "X",
      links: [{ href: "h1", rel: "self" }],
      details: [{ link: { href: "h1", rel: "self" } }, { links: [{ href: "h2", rel: "up", method: "GET" }] }],
    });
    expect(parsed.links).toEqual([
      { href: "h1", rel: "self" },
      { href: "h2", rel: "up", method: "GET" },
    ]);
  });
});
