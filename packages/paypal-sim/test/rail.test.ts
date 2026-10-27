// setupPayPalRail exactly as the README wires it into apps/api: publicBaseUrl is the host app's own URL,
// basePath "/paypal-sim", and the host app mounts rail.publicFetch (and nothing else) under that prefix.
// A real HTTP host app, the in-process interceptor and the simulator's deliveries, end to end: the cert URL
// and the pay page resolve through the mount, and a delivered webhook verifies with the certificate fetched
// from its own paypal-cert-url. No PayPal host is ever contacted.
import { createPublicKey, verify, X509Certificate } from "node:crypto";
import http, { createServer, type Server } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { crc32 } from "node:zlib";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PayPalRail, SIMULATED_RAIL_LABEL, setupPayPalRail } from "../src/integration.js";
import { createSandboxDispatcher, type DispatcherLike } from "../src/interceptor.js";
import { canonicalInvoice, newSim } from "./helpers.js";

const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");
const g = globalThis as unknown as Record<symbol, DispatcherLike | undefined>;
const noop = () => {};

/** The functions an installed interceptor replaces. */
function hooks() {
  return {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    dispatcher: g[GLOBAL_DISPATCHER],
  };
}

describe("PP_MODE=sandbox and mismatched credentials", () => {
  it("sandbox mode installs nothing: no simulator, no cert pattern, http/https and global fetch untouched", async () => {
    await (await fetch("data:text/plain,warm")).text(); // make sure Node created its global dispatcher
    const before = hooks();
    const rail = await setupPayPalRail({
      PP_MODE: "sandbox",
      PP_CLIENT_ID: "AFakeSandboxClientIdForTestsOnly000",
    });
    expect(rail).toMatchObject({
      mode: "sandbox",
      provenance: "live",
      label: null,
      simulator: null,
      publicFetch: null,
      interceptor: null,
      certUrlPattern: null,
    });
    expect(hooks()).toEqual(before);
    await rail.stop();
    expect(hooks()).toEqual(before);
  });

  it("refuses a simulator client id in sandbox mode, and a non-simulator client id in simulator mode", async () => {
    const before = hooks();
    await expect(setupPayPalRail({ PP_MODE: "sandbox", PP_CLIENT_ID: "SIM-fs-dev-client" })).rejects.toThrow(
      /simulator client id/,
    );
    await expect(
      setupPayPalRail(
        { PP_CLIENT_ID: "AFakeSandboxClientIdForTestsOnly000" },
        { speed: 0, logger: noop, dataDir: null },
      ),
    ).rejects.toThrow(/PP_MODE=sandbox to use real sandbox credentials/);
    expect(hooks()).toEqual(before); // the failed simulator-mode call installed nothing
  });

  it("refuses a publicBaseUrl that already ends in basePath (the doubled /paypal-sim/paypal-sim prefix)", async () => {
    const before = hooks();
    await expect(
      setupPayPalRail(
        { PP_MODE: "simulator" },
        {
          publicBaseUrl: "https://fs.example.org/paypal-sim",
          basePath: "/paypal-sim",
          speed: 0,
          logger: noop,
        },
      ),
    ).rejects.toThrow(/without basePath "\/paypal-sim"/);
    expect(hooks()).toEqual(before);
  });
});

describe("simulator rail mounted in a host app (README wiring)", () => {
  let host: Server;
  let hostUrl: string;
  let rail: PayPalRail;
  let realDispatcher: DispatcherLike | undefined;
  const deliveries: { headers: Headers; raw: string }[] = [];
  /** Live PayPal hosts that reached the network layer through global fetch (blocked by this test). */
  const liveSeen: string[] = [];

  beforeAll(async () => {
    host = createServer(
      getRequestListener(
        async (req) => {
          const url = new URL(req.url);
          if (url.pathname.startsWith("/paypal-sim/") && rail.publicFetch) return rail.publicFetch(req);
          if (url.pathname === "/webhooks/paypal" && req.method === "POST") {
            deliveries.push({ headers: req.headers, raw: await req.text() });
            return new Response(null, { status: 200 });
          }
          return new Response("not found in the host app", { status: 404 });
        },
        { overrideGlobalObjects: false },
      ),
    );
    await new Promise<void>((r) => host.listen(0, "127.0.0.1", () => r()));
    hostUrl = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;

    // Under the interceptor sits a stand-in for the network: live PayPal hosts fail here, everything else
    // (the host app on 127.0.0.1) goes to Node's real dispatcher.
    await (await fetch("data:text/plain,warm")).text();
    realDispatcher = g[GLOBAL_DISPATCHER];
    const real = realDispatcher as DispatcherLike;
    g[GLOBAL_DISPATCHER] = {
      dispatch(o, handler) {
        const origin = new URL(String(o.origin));
        if (origin.hostname === "api-m.paypal.com" || origin.hostname === "api.paypal.com") {
          liveSeen.push(origin.hostname);
          const err = new Error("a live PayPal host reached the network layer");
          const modern =
            typeof handler.onRequestStart === "function" || typeof handler.onResponseStart === "function";
          const controller = {
            abort() {},
            pause() {},
            resume() {},
            aborted: false,
            paused: false,
            reason: null,
          };
          queueMicrotask(() => {
            if (modern) {
              handler.onRequestStart?.(controller, {});
              handler.onResponseError?.(controller, err);
            } else {
              handler.onConnect?.(() => {});
              handler.onError?.(err);
            }
          });
          return true;
        }
        return real.dispatch(o, handler);
      },
      close: () => real.close(),
      destroy: () => real.destroy(),
    };

    rail = await setupPayPalRail(
      { PP_MODE: "simulator", PP_CLIENT_ID: "SIM-fs-dev-client" },
      { publicBaseUrl: hostUrl, basePath: "/paypal-sim", speed: 0, logger: noop, strictProperties: true },
    );
  });

  afterAll(async () => {
    expect(rail.simulator?.violations).toEqual([]);
    await rail.stop();
    g[GLOBAL_DISPATCHER] = realDispatcher;
    host.closeAllConnections();
    await new Promise<void>((r) => host.close(() => r()));
  });

  const sim = () => {
    if (!rail.simulator) throw new Error("no simulator");
    return rail.simulator;
  };
  const sandbox = "https://api-m.sandbox.paypal.com";
  let tok = "";
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${sandbox}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tok}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: test convenience for JSON bodies
    return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any };
  };

  it("inv.i8.rail-provenance: labels the rail: provenance simulated_rail and ADR-0002's wording", () => {
    expect(rail.mode).toBe("simulator");
    expect(rail.provenance).toBe("simulated_rail");
    expect(rail.label).toBe(SIMULATED_RAIL_LABEL);
    expect(rail.label).toBe("Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)");
  });

  it("puts the prefix in cert and pay-page URLs exactly once, and serves both through the mount", async () => {
    const app = sim().registry.apps.find((a) => a.client_id === "SIM-fs-dev-client");
    if (!app) throw new Error("no app");
    const basic = Buffer.from(`${app.client_id}:${app.client_secret}`).toString("base64");
    const t = await fetch(`${sandbox}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(t.status).toBe(200);
    tok = ((await t.json()) as { access_token: string }).access_token;

    const certUrl = sim().certUrl;
    expect(certUrl).toBe(`${hostUrl}/paypal-sim/sim/certs/${sim().signing.certId}.pem`);
    expect(rail.certUrlPattern?.test(certUrl)).toBe(true);
    const cert = await fetch(certUrl);
    expect(cert.status).toBe(200);
    expect(await cert.text()).toMatch(/^-----BEGIN CERTIFICATE-----/);

    const created = await api("POST", "/v2/invoicing/invoices", canonicalInvoice("FS-RAIL-1"), {
      prefer: "return=representation",
    });
    expect(created.status).toBe(201);
    const payUrl = created.json.detail.metadata.recipient_view_url as string;
    expect(payUrl).toBe(`${hostUrl}/paypal-sim/sim/invoice/${created.json.id}/pay`);
    expect(created.json.detail.metadata.invoicer_view_url).toBe(
      `${hostUrl}/paypal-sim/sim/invoice/${created.json.id}`,
    );
    const sent = await api("POST", `/v2/invoicing/invoices/${created.json.id}/send`, {
      send_to_recipient: false,
    });
    expect(sent.json).toMatchObject({ rel: "payer-view", href: payUrl });
    const page = await fetch(payUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Simulated PayPal sandbox");

    // Through the mount a visitor cannot name the payer (STATE SECURITY, payerKey): the billing recipient pays.
    const usd = (key: string) => sim().balance(key, "USD").available;
    const form = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    const named = await fetch(payUrl, { method: "POST", headers: form, body: "payer=M-007" });
    expect(named.status).toBe(422);
    expect(usd("M-007")).toBe(0);
    expect(usd("lantern-bay")).toBe(10_000_000);
    const paid = await fetch(payUrl, { method: "POST", headers: form, body: "" });
    expect(paid.status).toBe(200);
    expect(usd("lantern-bay")).toBe(10_000_000 - 433_350);
    expect(usd("M-007")).toBe(0);
  });

  it("delivers a signed webhook to the host app that verifies with the cert fetched from paypal-cert-url", async () => {
    const hook = await api("POST", "/v1/notifications/webhooks", {
      url: `${hostUrl}/webhooks/paypal`, // the host app's own origin: allowed by default, nothing else is
      event_types: [{ name: "INVOICING.INVOICE.PAID" }],
    });
    expect(hook.status).toBe(201);
    const webhookId = hook.json.id as string;
    const created = await api("POST", "/v2/invoicing/invoices", canonicalInvoice("FS-RAIL-2"), {
      prefer: "return=representation",
    });
    const id = created.json.id as string;
    await api("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: false });
    const paid = await api("POST", `/v2/invoicing/invoices/${id}/payments`, { method: "BANK_TRANSFER" });
    expect(paid.status).toBe(200);
    await sim().idle();

    const d = deliveries.find((x) => JSON.parse(x.raw).event_type === "INVOICING.INVOICE.PAID");
    if (!d) throw new Error("no INVOICING.INVOICE.PAID delivery reached the host app");
    expect(d.headers.get("x-fairsplit-simulated")).toBe("true");
    const certUrl = d.headers.get("paypal-cert-url") as string;
    expect(certUrl).toBe(sim().certUrl);
    expect(rail.certUrlPattern?.test(certUrl)).toBe(true);
    const pem = await (await fetch(certUrl)).text(); // through the host app's /paypal-sim mount
    const [leafPem, caPem] = pem.split(/(?<=-----END CERTIFICATE-----\n)/);
    expect(
      new X509Certificate(leafPem as string).verify(new X509Certificate(caPem as string).publicKey),
    ).toBe(true);
    const message = `${d.headers.get("paypal-transmission-id")}|${d.headers.get("paypal-transmission-time")}|${webhookId}|${crc32(Buffer.from(d.raw)) >>> 0}`;
    const sig = Buffer.from(d.headers.get("paypal-transmission-sig") as string, "base64");
    expect(verify("RSA-SHA256", Buffer.from(message), createPublicKey(pem), sig)).toBe(true);

    // The event's own links name PayPal's sandbox API host, which the interceptor answers in process.
    const event = JSON.parse(d.raw) as { id: string; links: { href: string; rel: string }[] };
    const self = event.links.find((l) => l.rel === "self")?.href as string;
    expect(self).toBe(`https://api.sandbox.paypal.com/v1/notifications/webhooks-events/${event.id}`);
    const followed = await fetch(self, { headers: { authorization: `Bearer ${tok}` } });
    expect(followed.status).toBe(200);
    expect(((await followed.json()) as { id: string }).id).toBe(event.id);
  });

  it("the public mount serves pages only: no REST API, no admin, no OAuth", async () => {
    const app = sim().registry.apps[0];
    const basic = Buffer.from(`${app?.client_id}:${app?.client_secret}`).toString("base64");
    const tokenViaMount = await fetch(`${hostUrl}/paypal-sim/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(tokenViaMount.status).toBe(404);
    const rest = await fetch(`${hostUrl}/paypal-sim/v1/notifications/webhooks`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(rest.status).toBe(404);
    const invoicesBefore = Object.keys(sim().state.invoices).length;
    for (const path of ["/sim/admin/reset", "/sim/admin/clock", "/sim/admin/deny-next-batch"]) {
      const res = await fetch(`${hostUrl}/paypal-sim${path}`, { method: "POST", body: "{}" });
      expect(res.status, path).toBe(404);
    }
    expect((await fetch(`${hostUrl}/paypal-sim/sim/admin/state`)).status).toBe(404);
    expect(Object.keys(sim().state.invoices).length).toBe(invoicesBefore);
    expect(sim().state.denyNextBatch).toBe(false);
    expect((await fetch(`${hostUrl}/paypal-sim/sim/health`)).status).toBe(200);
  });

  it("the interceptor's loopback listener answers PayPal's REST routes only (no /sim pages, no admin)", async () => {
    const loopback = rail.interceptor?.loopbackUrl as string;
    expect((await fetch(`${loopback}/sim/admin/state`)).status).toBe(404);
    expect((await fetch(`${loopback}/sim/admin/reset`, { method: "POST" })).status).toBe(404);
    const rest = await fetch(`${loopback}/v1/notifications/webhooks`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(rest.status).toBe(200);
  });

  it("live PayPal hosts bypass the interceptor (global fetch and node:https), sandbox hosts do not", async () => {
    const tokensBefore = Object.keys(sim().state.tokens).length;
    for (const live of ["https://api-m.paypal.com", "https://api.paypal.com"]) {
      const err = await fetch(`${live}/v1/oauth2/token`, { method: "POST" }).then(
        () => null,
        (e: unknown) => e as Error & { cause?: Error },
      );
      expect(err?.cause?.message ?? err?.message).toMatch(/live PayPal host reached the network layer/);
    }
    expect(liveSeen).toEqual(["api-m.paypal.com", "api.paypal.com"]);

    // node:https (axios): a live host goes to the original https.request (our lookup proves it, and fails
    // it before any connection); a sandbox host is rerouted and never looked up.
    const looked: string[] = [];
    const lookup = ((hostname: string, _opts: unknown, cb: (err: Error) => void) => {
      looked.push(hostname);
      cb(new Error("lookup blocked by the test"));
    }) as unknown as NonNullable<http.RequestOptions["lookup"]>;
    const viaHttps = (hostname: string) =>
      new Promise<{ status?: number; simulated?: string; error?: string }>((resolve) => {
        const req = https.request(
          { hostname, path: "/v1/notifications/webhooks", method: "GET", lookup },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode, simulated: String(res.headers["x-fairsplit-simulated"]) });
          },
        );
        req.on("error", (e) => resolve({ error: e.message }));
        req.end();
      });
    expect(await viaHttps("api-m.paypal.com")).toEqual({ error: "lookup blocked by the test" });
    expect(await viaHttps("api.paypal.com")).toEqual({ error: "lookup blocked by the test" });
    expect(looked).toEqual(["api-m.paypal.com", "api.paypal.com"]);
    const rerouted = await viaHttps("api-m.sandbox.paypal.com");
    expect(rerouted).toEqual({ status: 401, simulated: "true" });
    expect(looked).toEqual(["api-m.paypal.com", "api.paypal.com"]);
    expect(Object.keys(sim().state.tokens).length).toBe(tokensBefore);
  });
});

describe("createSandboxDispatcher routing", () => {
  it("hands live hosts and every non-sandbox host to the fallback, untouched", async () => {
    const sim = await newSim();
    const seen: string[] = [];
    const fallback: DispatcherLike = {
      dispatch: (o) => {
        seen.push(new URL(String(o.origin)).hostname);
        return true;
      },
      close: async () => {},
      destroy: async () => {},
    };
    const dispatcher = createSandboxDispatcher(sim, { fallback });
    for (const origin of ["https://api-m.paypal.com", "https://api.paypal.com", "https://example.org"])
      expect(dispatcher.dispatch({ origin, path: "/v1/oauth2/token", method: "POST" }, {})).toBe(true);
    expect(seen).toEqual(["api-m.paypal.com", "api.paypal.com", "example.org"]);
    await sim.close();
  });
});
