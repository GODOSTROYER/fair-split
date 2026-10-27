// The standalone server (Hono on @hono/node-server): real HTTP, the pay page, certificates, mounting.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { optionsFromEnv, resolvePayPalMode } from "../src/config.js";
import { type StartedServer, startServer } from "../src/server.js";
import { canonicalInvoice } from "./helpers.js";

describe("standalone server", () => {
  let server: StartedServer;
  let tok: string;

  beforeAll(async () => {
    server = await startServer({ port: 0, speed: 0, logger: () => {} });
    const app = server.simulator.registry.apps[0];
    const res = await fetch(`${server.url}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${app?.client_id}:${app?.client_secret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    tok = ((await res.json()) as { access_token: string }).access_token;
  });
  afterAll(async () => {
    expect(server.simulator.violations).toEqual([]);
    await server.close();
  });

  it("serves the PayPal routes over HTTP with host-agnostic HATEOAS links", async () => {
    const res = await fetch(`${server.url}/v2/invoicing/invoices`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(canonicalInvoice("FS-HTTP-1")),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
    expect(res.headers.get("paypal-debug-id")).toMatch(/^sim-/);
    const link = (await res.json()) as { href: string };
    expect(link.href.startsWith(`${server.url}/v2/invoicing/invoices/INV2-`)).toBe(true);
    const viaTunnel = await fetch(link.href, {
      headers: {
        authorization: `Bearer ${tok}`,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "fs-dev.example.org",
      },
    });
    const inv = (await viaTunnel.json()) as { links: { href: string }[] };
    expect(inv.links[0]?.href.startsWith("https://fs-dev.example.org/v2/invoicing/invoices/")).toBe(true);
  });

  it("renders and pays the pay page in a browser-like flow (form POST)", async () => {
    const created = await fetch(`${server.url}/v2/invoicing/invoices`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify(canonicalInvoice("FS-HTTP-PAY")),
    });
    const inv = (await created.json()) as {
      id: string;
      detail: { metadata: { recipient_view_url: string } };
    };
    await fetch(`${server.url}/v2/invoicing/invoices/${inv.id}/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ send_to_recipient: false }),
    });
    const pageUrl = inv.detail.metadata.recipient_view_url;
    expect(pageUrl.startsWith(server.url)).toBe(true);
    const page = await fetch(pageUrl);
    const html = await page.text();
    expect(html).toContain('<form method="post"');
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    const paid = await fetch(pageUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(paid.status).toBe(200);
    expect(await paid.text()).toContain("Paid (simulated PayPal payment)");
    const after = await fetch(`${server.url}/v2/invoicing/invoices/${inv.id}`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(((await after.json()) as { status: string }).status).toBe("PAID");
  });

  it("escapes invoice text on the page", async () => {
    const body = canonicalInvoice("FS-XSS");
    (body.detail as Record<string, string>).note = "<script>alert(1)</script>";
    const created = await fetch(`${server.url}/v2/invoicing/invoices`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    const inv = (await created.json()) as { id: string };
    const html = await (await fetch(`${server.url}/sim/invoice/${inv.id}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("serves the webhook certificate chain and a health check", async () => {
    const cert = await fetch(server.simulator.certUrl);
    expect(cert.status).toBe(200);
    expect(await cert.text()).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect((await fetch(`${server.url}/sim/certs/SIMCERT-00000000-00000000-00000000.pem`)).status).toBe(404);
    const health = (await (await fetch(`${server.url}/sim/health`)).json()) as { simulated: boolean };
    expect(health.simulated).toBe(true);
  });

  it("admin: state, delivery toggles and reset (Judge Mode)", async () => {
    const toggles = await fetch(`${server.url}/sim/admin/delivery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ duplicate: true }),
    });
    expect(((await toggles.json()) as { delivery: { duplicate: boolean } }).delivery.duplicate).toBe(true);
    const state = (await (await fetch(`${server.url}/sim/admin/state`)).json()) as { invoices: number };
    expect(state.invoices).toBeGreaterThan(0);
    const accounts = await (await fetch(`${server.url}/sim/admin/accounts`)).text();
    expect(accounts).not.toContain("secret");
    await fetch(`${server.url}/sim/admin/reset`, { method: "POST" });
    const after = (await (await fetch(`${server.url}/sim/admin/state`)).json()) as {
      invoices: number;
      delivery_toggles: { duplicate: boolean };
    };
    expect(after.invoices).toBe(0);
    expect(after.delivery_toggles.duplicate).toBe(false);
  });
});

describe("mounting under a base path with an admin token", () => {
  it("serves /sim pages under the prefix and PayPal routes at the root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paypal-sim-"));
    const server = await startServer({
      port: 0,
      speed: 0,
      basePath: "/paypal-sim",
      adminToken: "local-admin",
      dataDir: dir,
      logger: () => {},
    });
    try {
      expect(server.simulator.certUrl).toBe(
        `${server.url}/paypal-sim/sim/certs/${server.simulator.signing.certId}.pem`,
      );
      expect((await fetch(server.simulator.certUrl)).status).toBe(200);
      expect((await fetch(`${server.url}/paypal-sim/sim/health`)).status).toBe(200);
      expect((await fetch(`${server.url}/paypal-sim/sim/admin/state`)).status).toBe(401);
      expect(
        (
          await fetch(`${server.url}/paypal-sim/sim/admin/state`, {
            headers: { "x-sim-admin-token": "local-admin" },
          })
        ).status,
      ).toBe(200);
      expect(server.simulator.certUrlPattern.test(server.simulator.certUrl)).toBe(true);
      expect(
        server.simulator.certUrlPattern.test(
          "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d",
        ),
      ).toBe(false);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("configuration", () => {
  it("reads PP_MODE (simulator by default) and SIM_* variables", () => {
    expect(resolvePayPalMode({})).toBe("simulator");
    expect(resolvePayPalMode({ PP_MODE: "sandbox" })).toBe("sandbox");
    expect(() => resolvePayPalMode({ PP_MODE: "live" })).toThrow();
    const o = optionsFromEnv({
      SIM_SPEED: "0",
      SIM_RATE_LIMIT_PER_MIN: "0",
      SIM_LATENCY_MS: "80-250",
      SIM_OUT_OF_ORDER: "1",
      SIM_PUBLIC_URL: "https://fs.example.org/paypal-sim",
    });
    expect(o).toMatchObject({
      speed: 0,
      rateLimit: false,
      latencyMs: [80, 250],
      delivery: { outOfOrder: true, duplicate: false },
      publicBaseUrl: "https://fs.example.org/paypal-sim",
    });
    expect(optionsFromEnv({ SIM_RATE_LIMIT_PER_MIN: "40" }).rateLimit).toEqual({
      perMinute: 40,
      blockSeconds: 300,
    });
    expect(
      optionsFromEnv({
        SIM_WEBHOOK_ORIGINS: "https://fs.example.org, http://localhost:8787,",
        SIM_ALLOW_LOOPBACK_WEBHOOKS: "1",
        SIM_TRUST_PROXY: "true",
        SIM_IDEMPOTENCY: "all-posts",
        SIM_INVOICE_FEE_BPS: "0",
        SIM_INVOICE_FEE_CENTS: "0",
      }),
    ).toEqual({
      webhookOrigins: ["https://fs.example.org", "http://localhost:8787"],
      allowLoopbackWebhooks: true,
      trustProxy: true,
      idempotency: "all-posts",
      invoiceFee: { percentBps: 0, fixedCents: 0 },
    });
    expect(() => optionsFromEnv({ SIM_IDEMPOTENCY: "sometimes" })).toThrow(/SIM_IDEMPOTENCY/);
  });
});
