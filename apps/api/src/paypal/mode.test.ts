import { createMemoryLimiter } from "@fairsplit/paypal-core";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../env.js";
import { createPayPalMock, PAYPAL_SANDBOX } from "../test/paypal.js";
import { createPayPalRail, routeToSimulator, SIMULATOR_CLIENT, stubResponse } from "./mode.js";

const limiter = createMemoryLimiter();

describe("PayPal mode seam (ADR-0002)", () => {
  it("simulator mode without a simulator answers every PayPal call with a labelled 503 (nothing pretends to pay)", async () => {
    const network = vi.fn(async () => new Response("network"));
    const rail = createPayPalRail({ paypal: parseEnv({}).paypal, limiter, fetch: network });
    expect(rail.mode).toBe("simulator");
    expect(rail.label).toBe("simulated");
    expect(rail.provenance).toBe("simulated_rail");
    expect(rail.simulator).toEqual({ kind: "stub" });
    expect(rail.baseUrl).toBe("https://api-m.sandbox.paypal.com");
    const res = await rail.fetch(`${PAYPAL_SANDBOX}/v1/payments/payouts`, { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    expect(res.headers.get("x-fs-rail")).toBe("simulated");
    const body = (await res.json()) as { name: string; debug_id: string };
    expect(body.name).toBe("SIMULATOR_NOT_RUNNING");
    expect(body.debug_id).toMatch(/^sim-stub-/);
    // non-PayPal hosts (Render, Anthropic) still use the network
    await rail.fetch("https://api.render.com/v1/health");
    expect(network).toHaveBeenCalledOnce();
    expect(rail.describe()).toEqual({
      mode: "simulator",
      label: "simulated",
      provenance: "simulated_rail",
      simulator: { kind: "stub" },
      credentials: "placeholder",
      webhookId: "missing",
    });
  });

  it("the stub's OAuth fails as PayPal would, so the core reports PayPal unavailable", async () => {
    const rail = createPayPalRail({ paypal: parseEnv({}).paypal, limiter, sleep: async () => undefined });
    await expect(rail.core.auth.token()).rejects.toThrow();
    expect(rail.core.auth.status().failures).toBeGreaterThan(0);
  });

  it("PP_SIM_URL routes the sandbox hosts to a running simulator, keeping path and query", async () => {
    const network = vi.fn(async (input: string | URL) => new Response(String(input)));
    const rail = createPayPalRail({
      paypal: parseEnv({ PP_SIM_URL: "http://127.0.0.1:4010/" }).paypal,
      limiter,
      fetch: network,
    });
    expect(rail.simulator).toEqual({ kind: "remote", url: "http://127.0.0.1:4010" });
    const r = await rail.fetch("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?x=1");
    expect(await r.text()).toBe("http://127.0.0.1:4010/v1/notifications/certs/CERT-1?x=1");
  });

  it("an in-process simulator (packages/paypal-sim's handler) plugs in without changing callers", async () => {
    const seen: string[] = [];
    const rail = createPayPalRail({
      paypal: parseEnv({}).paypal,
      limiter,
      simulator: {
        name: "paypal-sim",
        fetch: async (req) => {
          seen.push(`${req.method} ${new URL(req.url).pathname}`);
          return HttpResponse.json({
            access_token: "sim",
            expires_in: 3600,
            scope: "",
            token_type: "Bearer",
            app_id: "sim",
            nonce: "n",
          });
        },
      },
    });
    expect(rail.simulator).toEqual({ kind: "in_process", name: "paypal-sim" });
    const token = await rail.core.auth.token();
    expect(token.v).toBe("sim");
    expect(seen).toEqual(["POST /v1/oauth2/token"]);
  });

  it("uses placeholder credentials in simulator mode, never real ones", () => {
    const rail = createPayPalRail({ paypal: parseEnv({}).paypal, limiter });
    expect(rail.describe().credentials).toBe("placeholder");
    expect(SIMULATOR_CLIENT.clientId).toBe("fs-sim-client");
  });

  it("routeToSimulator never captures http:// or look-alike hosts", async () => {
    const simulate = vi.fn(async (req: Request) => stubResponse(req));
    const network = vi.fn(async () => new Response("net"));
    const f = routeToSimulator(network, simulate);
    await f("http://api-m.sandbox.paypal.com/v1/x");
    await f("https://api-m.sandbox.paypal.com.evil.example/v1/x");
    await f("https://api-m.paypal.com/v1/x");
    expect(simulate).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("routeToSimulator captures a sandbox host whatever its case or a trailing dot: none reaches the network", async () => {
    const simulate = vi.fn(async (req: Request) => stubResponse(req));
    const network = vi.fn(async () => new Response("net"));
    const f = routeToSimulator(network, simulate);
    await f("https://API-M.SANDBOX.PAYPAL.COM/v1/x");
    await f("https://api-m.sandbox.paypal.com./v1/x");
    await f("https://Api.Sandbox.PayPal.Com./v1/x");
    expect(network).not.toHaveBeenCalled();
    expect(simulate).toHaveBeenCalledTimes(3);
  });
});

describe("sandbox mode", () => {
  const mock = createPayPalMock([
    http.get(`${PAYPAL_SANDBOX}/v2/invoicing/invoices/INV2-TEST`, () =>
      HttpResponse.json({ id: "INV2-TEST", status: "PAID" }),
    ),
  ]);
  beforeAll(() => mock.start());
  afterAll(() => mock.stop());

  it("talks to the sandbox host (msw in tests), labelled `sandbox` with live provenance", async () => {
    const rail = createPayPalRail({
      paypal: parseEnv({
        PP_MODE: "sandbox",
        PP_CLIENT_ID: "test-id",
        PP_CLIENT_SECRET: "test-secret",
        PP_WEBHOOK_ID: "WH1",
      }).paypal,
      limiter,
    });
    expect(rail.simulator).toBeNull();
    expect(rail.label).toBe("sandbox");
    expect(rail.provenance).toBe("live");
    expect(rail.describe().credentials).toBe("configured");
    const res = await rail.core.http.request({
      method: "GET",
      path: "/v2/invoicing/invoices/INV2-TEST",
      purpose: "invoices.get",
      priority: "live",
    });
    expect(res.ok).toBe(true);
  });
});
