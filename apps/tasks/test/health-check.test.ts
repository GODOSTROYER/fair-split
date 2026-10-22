import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BALANCE_WARN_CENTS,
  type CheckResult,
  exitCodeFor,
  formatUsd,
  missingScopes,
  PAYPAL_SANDBOX_BASE,
  parseArgs,
  paypalMode,
  REQUIRED_WEBHOOK_EVENTS,
  renderResults,
  runHealthChecks,
  scrub,
  toCents,
} from "../../../tools/health-check.js";
import { assertSandbox } from "../src/kill.js";

const ORIGIN = "https://fs-api.example.test";
const CLIENT_ID = "test-client-id-0001";
const CLIENT_SECRET = "test-client-secret-0001";
const ACCESS = "A21AA-fake-access-token-for-tests";
const env = {
  PP_ENV: "sandbox",
  PP_MODE: "sandbox",
  PP_CLIENT_ID: CLIENT_ID,
  PP_CLIENT_SECRET: CLIENT_SECRET,
  PP_WEBHOOK_ID: "WH-TEST-1",
};
const SEARCH_SCOPE = "https://uri.paypal.com/services/reporting/search/read";
const FULL_SCOPE = [
  "openid",
  "https://uri.paypal.com/services/invoicing",
  "https://uri.paypal.com/services/payments/payouts",
  SEARCH_SCOPE,
  "https://uri.paypal.com/services/reporting/balances/read",
].join(" ");

let paypalCalls = 0;
let lastAuth: string | null = null;

const hook = (events: string[], url = `${ORIGIN}/webhooks/paypal`) => ({
  webhooks: [
    { id: "WH-OTHER", url: "https://elsewhere.test/hook", event_types: [{ name: "*" }] },
    { id: "WH-TEST-1", url, event_types: events.map((name) => ({ name })) },
  ],
});

const defaults = [
  http.get(`${ORIGIN}/healthz`, () => HttpResponse.json({ ok: true })),
  http.get(`${ORIGIN}/readyz`, () => HttpResponse.json({ ok: true })),
  http.post(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, ({ request }) => {
    paypalCalls++;
    lastAuth = request.headers.get("authorization");
    return HttpResponse.json({
      access_token: ACCESS,
      scope: FULL_SCOPE,
      expires_in: 32400,
      token_type: "Bearer",
    });
  }),
  http.get(`${PAYPAL_SANDBOX_BASE}/v1/notifications/webhooks`, ({ request }) => {
    paypalCalls++;
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS}`);
    return HttpResponse.json(hook([...REQUIRED_WEBHOOK_EVENTS]));
  }),
  http.get(`${PAYPAL_SANDBOX_BASE}/v1/reporting/balances`, ({ request }) => {
    paypalCalls++;
    expect(new URL(request.url).searchParams.get("currency_code")).toBe("USD");
    return HttpResponse.json({
      balances: [
        { currency: "USD", primary: true, available_balance: { currency_code: "USD", value: "98761.25" } },
      ],
    });
  }),
];

const server = setupServer(...defaults);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  paypalCalls = 0;
  lastAuth = null;
});
afterAll(() => server.close());

const byName = (rs: CheckResult[]) => Object.fromEntries(rs.map((r) => [r.name, r]));

describe("health-check", () => {
  it("all green: liveness, readiness, token scope, webhook registration and balance in 3 PayPal calls", async () => {
    const rs = await runHealthChecks({ env, fetch, origin: ORIGIN });
    expect(rs.map((r) => [r.name, r.status])).toEqual([
      ["api.healthz", "ok"],
      ["api.readyz", "ok"],
      ["paypal.env", "ok"],
      ["paypal.mode", "ok"],
      ["paypal.token", "ok"],
      ["paypal.webhook", "ok"],
      ["paypal.balance", "ok"],
    ]);
    expect(byName(rs)["paypal.balance"]?.detail).toBe("US$98,761.25 available");
    expect(byName(rs)["paypal.webhook"]?.detail).toBe("WH-TEST-1: 15 events");
    expect(paypalCalls).toBe(3);
    expect(lastAuth).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`);
    expect(exitCodeFor(rs)).toBe(0);
  });

  it("never prints the client id, secret or access token", async () => {
    const rs = await runHealthChecks({ env, fetch, origin: ORIGIN });
    for (const json of [false, true]) {
      const out = renderResults(rs, env, json);
      for (const secret of [CLIENT_ID, CLIENT_SECRET, ACCESS]) expect(out).not.toContain(secret);
    }
  });

  it("skips PayPal checks, without calling PayPal, until credentials exist", async () => {
    const rs = await runHealthChecks({
      env: { PP_ENV: "sandbox", PP_MODE: "sandbox" },
      fetch,
      origin: ORIGIN,
    });
    expect(byName(rs)["paypal.mode"]).toMatchObject({ status: "ok", detail: "sandbox: PayPal's sandbox" });
    const calls = rs.filter((r) => ["paypal.token", "paypal.webhook", "paypal.balance"].includes(r.name));
    expect(calls.map((r) => [r.status, r.detail])).toEqual(
      Array(3).fill(["skip", "PP_CLIENT_ID / PP_CLIENT_SECRET not set"]),
    );
    expect(paypalCalls).toBe(0);
    expect(exitCodeFor(rs)).toBe(0);
  });

  it("refuses anything but the sandbox", async () => {
    const rs = await runHealthChecks({ env: { ...env, PP_ENV: "live" }, fetch, origin: ORIGIN });
    expect(byName(rs)["paypal.env"]?.status).toBe("fail");
    expect(paypalCalls).toBe(0);
    expect(exitCodeFor(rs)).toBe(1);
  });

  it("treats PP_ENV unset as not sandbox, exactly like the boot check (assertSandbox)", async () => {
    const { PP_ENV: _unset, ...rest } = env;
    const rs = await runHealthChecks({ env: rest, fetch, origin: ORIGIN });
    expect(byName(rs)["paypal.env"]).toEqual({
      name: "paypal.env",
      status: "fail",
      detail: "PP_ENV is unset; the boot check refuses anything but sandbox",
    });
    expect(() => assertSandbox(rest)).toThrow();
    expect(paypalCalls).toBe(0);
    expect(exitCodeFor(rs)).toBe(1);
  });

  it.each([
    ["unset (the ADR-0002 default)", undefined],
    ["simulator", "simulator"],
  ])(
    "inv.i8.simulated-rail-labelled: PP_MODE %s skips the sandbox checks, labelled, with no PayPal call",
    async (_label, mode) => {
      const rs = await runHealthChecks({ env: { ...env, PP_MODE: mode }, fetch, origin: ORIGIN });
      expect(byName(rs)["paypal.mode"]).toMatchObject({
        status: "ok",
        detail: expect.stringMatching(/simulated rail/),
      });
      for (const name of ["paypal.token", "paypal.webhook", "paypal.balance"])
        expect(byName(rs)[name]).toMatchObject({
          status: "skip",
          detail: expect.stringMatching(/PP_MODE=simulator/),
        });
      expect(paypalCalls).toBe(0);
      expect(exitCodeFor(rs)).toBe(0);
    },
  );

  it("fails an unknown PP_MODE without calling PayPal", async () => {
    const rs = await runHealthChecks({ env: { ...env, PP_MODE: "live" }, fetch, origin: ORIGIN });
    expect(byName(rs)["paypal.mode"]?.status).toBe("fail");
    expect(byName(rs)["paypal.token"]).toBeUndefined();
    expect(paypalCalls).toBe(0);
    expect(paypalMode({ PP_MODE: " sandbox " })).toBe("sandbox");
    expect(paypalMode({})).toBe("simulator");
    expect(paypalMode({ PP_MODE: "Sandbox" })).toBeUndefined();
  });

  it("uses FS_API_ORIGIN when no --origin is given, and skips the API checks with neither", async () => {
    const withEnv = await runHealthChecks({ env: { FS_API_ORIGIN: `${ORIGIN}/` }, fetch });
    expect(byName(withEnv)["api.healthz"]?.status).toBe("ok");
    const without = await runHealthChecks({ env: {}, fetch });
    expect(byName(without)["api.healthz"]?.status).toBe("skip");
  });

  it("fails on a dead /healthz but only warns on a red /readyz", async () => {
    server.use(
      http.get(`${ORIGIN}/healthz`, () => new HttpResponse(null, { status: 502 })),
      http.get(`${ORIGIN}/readyz`, () => HttpResponse.json({ ok: false }, { status: 503 })),
    );
    const rs = byName(await runHealthChecks({ env: {}, fetch, origin: ORIGIN }));
    expect(rs["api.healthz"]).toMatchObject({ status: "fail", detail: "HTTP 502" });
    expect(rs["api.readyz"]).toMatchObject({ status: "warn", detail: "HTTP 503" });
  });

  it("detects webhook drift: missing events and a stale URL", async () => {
    server.use(
      http.get(`${PAYPAL_SANDBOX_BASE}/v1/notifications/webhooks`, () =>
        HttpResponse.json(
          hook(REQUIRED_WEBHOOK_EVENTS.slice(0, 13), "https://old-tunnel.trycloudflare.com/webhooks/paypal"),
        ),
      ),
    );
    const w = byName(await runHealthChecks({ env, fetch, origin: ORIGIN }))["paypal.webhook"];
    expect(w?.status).toBe("fail");
    expect(w?.detail).toContain("url drift");
    expect(w?.detail).toContain("missing 2 events: PAYMENT.PAYOUTS-ITEM.HELD, PAYMENT.PAYOUTS-ITEM.REFUNDED");
  });

  it("fails when our webhook id is not registered", async () => {
    const rs = byName(
      await runHealthChecks({ env: { ...env, PP_WEBHOOK_ID: "WH-GONE" }, fetch, origin: ORIGIN }),
    );
    expect(rs["paypal.webhook"]).toMatchObject({ status: "fail" });
    expect(rs["paypal.webhook"]?.detail).toContain("WH-GONE not registered (2 on app)");
  });

  it("accepts a wildcard subscription", async () => {
    server.use(
      http.get(`${PAYPAL_SANDBOX_BASE}/v1/notifications/webhooks`, () => HttpResponse.json(hook(["*"]))),
    );
    const w = byName(await runHealthChecks({ env, fetch, origin: ORIGIN }))["paypal.webhook"];
    expect(w).toMatchObject({ status: "ok", detail: "WH-TEST-1: all events (*)" });
  });

  it.each([
    ["10000.00", "ok"],
    ["9999.99", "warn"],
    ["5000.00", "warn"],
    ["4999.99", "fail"],
  ])("balance %s is %s (alert under US$10k, replay under US$5k)", async (value, status) => {
    server.use(
      http.get(`${PAYPAL_SANDBOX_BASE}/v1/reporting/balances`, () =>
        HttpResponse.json({
          balances: [{ currency: "USD", available_balance: { currency_code: "USD", value } }],
        }),
      ),
    );
    const b = byName(await runHealthChecks({ env, fetch }))["paypal.balance"];
    expect(b?.status).toBe(status);
  });

  it("matches scopes exactly: Transaction Search's reporting/search/read does not cover balances", () => {
    expect(missingScopes(FULL_SCOPE)).toEqual([]);
    expect(missingScopes(SEARCH_SCOPE)).toEqual(["invoicing", "payouts", "reporting/balances"]);
    // A substring of a required scope is not that scope.
    expect(
      missingScopes("https://uri.paypal.com/services/reporting https://uri.paypal.com/services/payments"),
    ).toEqual(["invoicing", "payouts", "reporting/search", "reporting/balances"]);
  });

  it("a token with only search/read and a 403 on balances fails the run (exit 1): the US$5k guard is blind", async () => {
    server.use(
      http.post(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, () =>
        HttpResponse.json({ access_token: ACCESS, scope: SEARCH_SCOPE, expires_in: 100 }),
      ),
      http.get(`${PAYPAL_SANDBOX_BASE}/v1/reporting/balances`, () =>
        HttpResponse.json({ name: "NOT_AUTHORIZED" }, { status: 403 }),
      ),
    );
    const results = await runHealthChecks({ env, fetch, origin: ORIGIN });
    const r = byName(results);
    expect(r["paypal.token"]).toMatchObject({
      status: "fail",
      detail: "scope missing: invoicing, payouts, reporting/balances",
    });
    expect(r["paypal.balance"]).toMatchObject({ status: "fail" });
    expect(r["paypal.balance"]?.detail).toMatch(/List Balances/);
    expect(exitCodeFor(results)).toBe(1);
  });

  it("a 403 on balances fails even when the token claims every scope", async () => {
    server.use(
      http.get(`${PAYPAL_SANDBOX_BASE}/v1/reporting/balances`, () =>
        HttpResponse.json({ name: "NOT_AUTHORIZED" }, { status: 403 }),
      ),
    );
    const results = await runHealthChecks({ env, fetch });
    expect(byName(results)["paypal.balance"]?.status).toBe("fail");
    expect(exitCodeFor(results)).toBe(1);
  });

  it("stops after a failed token call", async () => {
    server.use(
      http.post(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, () =>
        HttpResponse.json({ error: "invalid_client" }, { status: 401 }),
      ),
    );
    const rs = await runHealthChecks({ env, fetch });
    expect(rs.at(-1)).toMatchObject({ name: "paypal.token", status: "fail", detail: "HTTP 401" });
    expect(exitCodeFor(rs)).toBe(1);
  });

  it("reports an unreachable API without leaking error text", async () => {
    server.use(http.get(`${ORIGIN}/healthz`, () => HttpResponse.error()));
    const h = byName(await runHealthChecks({ env: {}, fetch, origin: ORIGIN }))["api.healthz"];
    expect(h?.status).toBe("fail");
    expect(h?.detail).toMatch(/^unreachable \(/);
  });
});

describe("health-check helpers", () => {
  it("parses money to integer cents without floats", () => {
    expect(toCents("98761.25")).toBe(9_876_125);
    expect(toCents("10000")).toBe(BALANCE_WARN_CENTS);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("-3.2")).toBe(-320);
    expect(() => toCents("1e5")).toThrow();
  });
  it("formats US$ with grouping", () => {
    expect(formatUsd(436_839)).toBe("US$4,368.39");
    expect(formatUsd(-5)).toBe("-US$0.05");
  });
  it("scrubs secrets and bearer/basic credentials", () => {
    expect(scrub(`id=${CLIENT_ID} Authorization: Bearer abc.def-ghi Basic Zm9vOmJhcg==`, [CLIENT_ID])).toBe(
      "id=REDACTED Authorization: Bearer REDACTED Basic REDACTED",
    );
  });
  it("parses CLI arguments", () => {
    expect(parseArgs(["--origin=https://x.test", "--json"])).toEqual({
      origin: "https://x.test",
      json: true,
    });
    expect(() => parseArgs(["--secret"])).toThrow();
  });
});
