import { inspect } from "node:util";
import { HttpResponse, http } from "msw/http";
import { describe, expect, it } from "vitest";
import { createPayPalAuth, TOKEN_REFRESH_SKEW_MS } from "./auth.js";
import { PayPalAuthError, PayPalConfigError } from "./errors.js";
import type { PayPalCallRecord } from "./recorder.js";
import {
  manualClock,
  oauthHandler,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "./test-support.js";

useMswServer();

const newAuth = (extra: Partial<Parameters<typeof createPayPalAuth>[0]> = {}) =>
  createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET, ...extra });

describe("PayPalAuth: OAuth client credentials", () => {
  it("POSTs grant_type=client_credentials with HTTP Basic auth to the sandbox", async () => {
    const { handler, stub } = oauthHandler();
    server.use(handler);
    const token = await newAuth().token();
    expect(token.v).toBe("tok-1");
    expect(stub.bodies).toEqual(["grant_type=client_credentials"]);
    const expected = `Basic ${Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString("base64")}`;
    expect(stub.authorizations).toEqual([expected]);
    expect(token.scopes).toContain("https://uri.paypal.com/payments/payouts");
    expect(token.appId).toBe("APP-FSTEST");
  });

  it("computes expiry from when the request was sent", async () => {
    const clock = manualClock();
    const { handler } = oauthHandler({ expiresIn: 32_400 });
    server.use(handler);
    const token = await newAuth({ now: clock.now }).token();
    expect(token.exp).toBe(clock.now() + 32_400_000);
  });

  it("single-flight: 50 concurrent callers share one token request", async () => {
    const { handler, stub } = oauthHandler({ delayMs: 25 });
    server.use(handler);
    const auth = newAuth();
    const tokens = await Promise.all(Array.from({ length: 50 }, () => auth.token()));
    expect(stub.calls).toBe(1);
    expect(new Set(tokens.map((t) => t.v))).toEqual(new Set(["tok-1"]));
    expect(auth.status().fetches).toBe(1);
  });

  it("serves the cached token until 5 minutes before expiry, then refreshes exactly once", async () => {
    const clock = manualClock();
    const { handler, stub } = oauthHandler({ expiresIn: 3600 });
    server.use(handler);
    const auth = newAuth({ now: clock.now });
    expect((await auth.token()).v).toBe("tok-1");
    clock.advance(3600_000 - TOKEN_REFRESH_SKEW_MS - 1);
    expect((await auth.token()).v).toBe("tok-1");
    expect(stub.calls).toBe(1);
    clock.advance(1);
    const refreshed = await Promise.all([auth.token(), auth.token(), auth.token()]);
    expect(refreshed.map((t) => t.v)).toEqual(["tok-2", "tok-2", "tok-2"]);
    expect(stub.calls).toBe(2);
  });

  it("invalidate(token) drops only that token; a stale invalidation is ignored", async () => {
    const { handler, stub } = oauthHandler();
    server.use(handler);
    const auth = newAuth();
    const first = await auth.token();
    auth.invalidate(first.v);
    const second = await auth.token();
    expect(second.v).toBe("tok-2");
    auth.invalidate(first.v); // a late 401 for the old token must not evict the new one
    expect((await auth.token()).v).toBe("tok-2");
    expect(stub.calls).toBe(2);
  });

  it("propagates a failure to every concurrent caller, then retries on the next call", async () => {
    const failing = oauthHandler({ status: 401, delayMs: 10 });
    server.use(failing.handler);
    const auth = newAuth();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => auth.token()));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(failing.stub.calls).toBe(1);
    const reason = (results[0] as PromiseRejectedResult).reason as PayPalAuthError;
    expect(reason).toBeInstanceOf(PayPalAuthError);
    expect(reason.kind).toBe("http");
    expect(reason.status).toBe(401);
    expect(reason.oauthError).toBe("invalid_client");
    expect(reason.debugId).toBe("dbg-oauth-fail");
    expect(reason.message).not.toContain(TEST_CLIENT_SECRET);

    const ok = oauthHandler();
    server.use(ok.handler);
    expect((await auth.token()).v).toBe("tok-1");
  });

  it("keeps serving a still-valid token when the early refresh fails, and backs off", async () => {
    const clock = manualClock();
    const ok = oauthHandler({ expiresIn: 3600 });
    server.use(ok.handler);
    const auth = newAuth({ now: clock.now });
    await auth.token();
    clock.advance(3600_000 - 120_000); // 2 minutes left: inside the 5-minute refresh window
    const failing = oauthHandler({ status: 503, errorBody: { error: "temporarily_unavailable" } });
    server.use(failing.handler);
    expect((await auth.token()).v).toBe("tok-1");
    expect(failing.stub.calls).toBe(1);
    expect((await auth.token()).v).toBe("tok-1"); // inside the 15 s backoff: no new request
    expect(failing.stub.calls).toBe(1);
    expect(auth.status().lastError).toContain("503");
    clock.advance(120_000 - 10_000); // only 10 s left: below the 30 s grace, so it must fail
    await expect(auth.token()).rejects.toBeInstanceOf(PayPalAuthError);
  });

  it("never exposes the bearer value through JSON, inspect or spread", async () => {
    const { handler } = oauthHandler();
    server.use(handler);
    const token = await newAuth().token();
    expect(token.v).toBe("tok-1");
    expect(JSON.stringify(token)).not.toContain("tok-1");
    expect(inspect(token)).not.toContain("tok-1");
    expect(JSON.stringify({ ...token })).not.toContain("tok-1");
    expect(Object.isFrozen(token)).toBe(true);
  });

  it("reports a timeout as a typed error", async () => {
    const auth = newAuth({
      fetch: async () => {
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      },
    });
    const err = await auth.token().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalAuthError);
    expect((err as PayPalAuthError).kind).toBe("timeout");
  });

  it("rejects a malformed token response", async () => {
    server.use(http.post(`${SANDBOX}/v1/oauth2/token`, () => HttpResponse.json({ token_type: "Bearer" })));
    const err = await newAuth()
      .token()
      .catch((e: unknown) => e);
    expect((err as PayPalAuthError).kind).toBe("invalid_response");
  });

  it("records the token call for the limiter window without the credentials", async () => {
    const { handler } = oauthHandler();
    server.use(handler);
    const records: PayPalCallRecord[] = [];
    await newAuth({ recorder: { record: (r) => void records.push(r) } }).token();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      purpose: "oauth.token",
      status: 200,
      path: "/v1/oauth2/token",
      debugId: "dbg-oauth-1",
    });
    expect(JSON.stringify(records)).not.toContain(TEST_CLIENT_SECRET);
  });

  it("checks scopes from the token", async () => {
    const { handler } = oauthHandler({ scope: "https://uri.paypal.com/services/invoicing openid" });
    server.use(handler);
    const report = await newAuth().capabilities();
    expect(report.ok).toBe(false);
    expect(report.missingRequired).toEqual(["payouts", "webhooks"]);
  });

  it("is sandbox-only and requires credentials", () => {
    expect(() => newAuth({ env: "live" })).toThrow(PayPalConfigError);
    expect(() => createPayPalAuth({ clientId: "", clientSecret: "" })).toThrow(/client id and client secret/);
    expect(() => newAuth({ baseUrl: "https://evil.example.com" })).toThrow(PayPalConfigError);
    expect(() => newAuth({ baseUrl: "http://api-m.sandbox.paypal.com" })).toThrow(PayPalConfigError);
  });
});
