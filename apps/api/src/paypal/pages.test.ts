import { createSimulator, type Simulator } from "@fairsplit/paypal-sim";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/context.js";
import { mountSimulatorPages } from "./pages.js";

const origin = "http://localhost:8787";
let sim: Simulator;
let app: Hono<AppEnv>;

beforeAll(async () => {
  sim = await createSimulator({ publicBaseUrl: origin, basePath: "/paypal-sim", speed: 0, logger: () => {} });
  app = new Hono<AppEnv>();
  mountSimulatorPages(app, { basePath: "/paypal-sim", baseUrl: sim.pagesBaseUrl, fetch: sim.publicFetch });
});
afterAll(async () => {
  await sim?.close();
});

function streamed(headers: Record<string, string> = {}) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1024));
      if (pulls === 1024) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit = { method: "POST", headers, body, duplex: "half" };
  return {
    request: new Request(`${origin}/paypal-sim/sim/invoice/missing/pay`, init),
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
}

describe("HD6-1a bounded public simulator mount", () => {
  it.each<Record<string, string>>([{}, { "content-length": "10" }])(
    "refuses a streamed megabyte without draining it (%j)",
    async (headers) => {
      const source = streamed(headers);
      expect((await app.fetch(source.request)).status).toBe(413);
      expect(source.pulls()).toBeLessThanOrEqual(7);
      expect(source.cancelled()).toBe(true);
    },
  );

  it("refuses an oversized declared length before reading a byte", async () => {
    const source = streamed({ "content-length": "2000000" });
    expect((await app.fetch(source.request)).status).toBe(413);
    expect(source.pulls()).toBeLessThanOrEqual(1); // the stream's initial queued chunk only
  });

  it("keeps GET and HEAD certificate responses unchanged", async () => {
    const certUrl = sim.certUrl;
    const direct = await sim.publicFetch(new Request(certUrl));
    const mounted = await app.fetch(new Request(certUrl));
    expect(mounted.status).toBe(200);
    expect(mounted.headers.get("content-type")).toBe(direct.headers.get("content-type"));
    expect(await mounted.text()).toBe(await direct.text());
    expect((await app.fetch(new Request(certUrl, { method: "HEAD" }))).status).toBe(200);
  });

  it("an empty-form POST still pays a real invoice and its GET is unchanged", async () => {
    const client = sim.registry.apps[0];
    if (!client) throw new Error("missing simulator app");
    const auth = await sim.apiFetch(
      new Request("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      }),
    );
    const token = ((await auth.json()) as { access_token: string }).access_token;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const created = await sim.apiFetch(
      new Request("https://api-m.sandbox.paypal.com/v2/invoicing/invoices", {
        method: "POST",
        headers,
        body: JSON.stringify({
          detail: { currency_code: "USD", invoice_number: "HD6-PAGES" },
          invoicer: { email_address: "bulawanon.coop@example.org" },
          primary_recipients: [{ billing_info: { email_address: "lantern.bay.payables@example.org" } }],
          items: [{ name: "Premium", quantity: "1", unit_amount: { currency_code: "USD", value: "1.00" } }],
        }),
      }),
    );
    expect(created.status).toBe(201);
    const invoiceUrl = ((await created.json()) as { href: string }).href;
    const id = invoiceUrl.split("/").at(-1);
    expect(
      (await sim.apiFetch(new Request(`${invoiceUrl}/send`, { method: "POST", headers, body: "{}" }))).status,
    ).toBe(200);
    const url = `${origin}/paypal-sim/sim/invoice/${id}`;
    expect(await (await app.fetch(new Request(url))).text()).toBe(
      await (await sim.publicFetch(new Request(url))).text(),
    );
    const paid = await app.fetch(
      new Request(`${url}/pay`, { method: "POST", headers: { accept: "application/json" }, body: "" }),
    );
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ status: "PAID", simulated: true });
  });
});
