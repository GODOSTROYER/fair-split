// Tests that kill mutation-testing survivors (handoff T3) in PayPalHttp's request building: the
// idempotency header is sent exactly when there is a request id, a malformed id is refused before any
// call, a body is either JSON or raw JSON, never both, and its content type goes only with a body.
import { HttpResponse, http } from "msw/http";
import { describe, expect, it } from "vitest";
import { createPayPalAuth } from "./auth.js";
import { createPayPalHttp } from "./http.js";
import { unlimitedLimiter } from "./limiter.js";
import {
  oauthHandler,
  recordingSleep,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "./test-support.js";

useMswServer();

function setup() {
  const oauth = oauthHandler();
  server.use(oauth.handler);
  const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
  const seen: { headers: Headers; body: string }[] = [];
  server.use(
    http.all(`${SANDBOX}/v1/payments/payouts*`, async ({ request }) => {
      seen.push({ headers: request.headers, body: await request.text() });
      return HttpResponse.json({ ok: true }, { status: 200 });
    }),
  );
  const client = createPayPalHttp({ auth, limiter: unlimitedLimiter, sleep: recordingSleep().sleep });
  return { client, seen };
}

describe("PayPalHttp request building", () => {
  it("sends PayPal-Request-Id only when the call has one", async () => {
    const { client, seen } = setup();
    await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      body: {},
      requestId: "rid-1",
      purpose: "payouts.create",
      priority: "live",
    });
    expect(seen.map((s) => s.headers.get("paypal-request-id"))).toEqual([null, "rid-1"]);
  });

  it("sends a JSON content type only with a body, and the raw JSON exactly as given", async () => {
    const { client, seen } = setup();
    await client.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      purpose: "payouts.get",
      priority: "live",
    });
    await client.request({
      method: "POST",
      path: "/v1/payments/payouts",
      rawJsonBody: '{"a": 1}',
      purpose: "payouts.create",
      priority: "live",
    });
    expect(seen.map((s) => s.headers.get("content-type"))).toEqual([null, "application/json"]);
    expect(seen[1]?.body).toBe('{"a": 1}');
  });

  it("refuses a malformed request id, and a body given twice, without calling PayPal", async () => {
    const { client, seen } = setup();
    await expect(
      client.request({
        method: "POST",
        path: "/v1/payments/payouts",
        body: {},
        requestId: "bad\nid",
        purpose: "payouts.create",
        priority: "live",
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "invalid_request",
      message: "PayPal-Request-Id must be 1-1000 printable ASCII characters",
    });
    await expect(
      client.request({
        method: "POST",
        path: "/v1/payments/payouts",
        body: {},
        rawJsonBody: "{}",
        purpose: "payouts.create",
        priority: "live",
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "invalid_request",
      message: "pass either body or rawJsonBody, not both",
    });
    expect(seen).toEqual([]);
  });
});
