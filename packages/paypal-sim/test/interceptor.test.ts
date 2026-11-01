// The real PayPal client code paths, unmodified, against the simulator in-process:
// @paypal/agent-toolkit 1.11.0 (axios → node:https) and @paypal/paypal-server-sdk 2.5.0 (APIMatic/axios),
// plus the global fetch (undici dispatcher). Imported here only; the package itself never depends on them.
import { createServer, request as httpRequest, type RequestOptions } from "node:http";
import type { AddressInfo } from "node:net";
import { PayPalAPI, PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { Client, Environment, TransactionSearchController } from "@paypal/paypal-server-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSandboxDispatcher,
  type InstalledInterceptor,
  installSandboxInterceptor,
} from "../src/interceptor.js";
import type { Simulator } from "../src/simulator.js";
import {
  BEYOND_TEST_TIMEOUT_MS,
  BUSINESS_EMAIL,
  batchBody,
  MEMBER_PAYOUTS,
  newSim,
  PAYER_EMAIL,
  plusDays,
  ptToday,
} from "./helpers.js";

describe("in-process interceptor", () => {
  let sim: Simulator;
  let installed: InstalledInterceptor;
  let accessToken: string;
  const app = () => {
    const a = sim.registry.apps[0];
    if (!a) throw new Error("no app");
    return a;
  };

  beforeAll(async () => {
    sim = await newSim();
    installed = await installSandboxInterceptor(sim);
  });
  afterAll(async () => {
    await installed.uninstall();
    expect(sim.violations).toEqual([]);
    await sim.close();
  });

  it("routes the global fetch for the sandbox host to the simulator", async () => {
    const basic = Buffer.from(`${app().client_id}:${app().client_secret}`).toString("base64");
    const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
    const json = (await res.json()) as { access_token: string };
    accessToken = json.access_token;
    expect(accessToken).toMatch(/^SIM\./);
  });

  it("refuses bad client credentials with 401 invalid_client", async () => {
    const basic = Buffer.from(`${app().client_id}:wrong`).toString("base64");
    const res = await fetch("https://api.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "invalid_client",
      error_description: "Client Authentication failed",
    });
  });

  it("leaves other hosts alone (a local server is reached for real)", async () => {
    const server = createServer((_req, res) => res.end("real"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe("real");
    expect(res.headers.get("x-fairsplit-simulated")).toBeNull();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("runs @paypal/agent-toolkit create_invoice / get_invoice unmodified", async () => {
    const toolkit = new PayPalMCPToolkit({
      accessToken: "-",
      configuration: {
        actions: {
          invoices: {
            create: true,
            get: true,
            send: true,
            createConditionalRules: true,
            recordPayment: true,
            search: true,
          },
        },
        context: { sandbox: true },
      },
    });
    const schema = (method: string) => {
      const tool = toolkit.getTools().find((t) => t.method === method);
      if (!tool) throw new Error(`no tool ${method}`);
      return tool.parameters;
    };
    const run = async (method: string, args: unknown, requestId?: string) => {
      const api = new PayPalAPI(accessToken, {
        sandbox: true,
        ...(requestId ? { request_id: requestId } : {}),
      });
      return JSON.parse(await api.run(method, schema(method).parse(args)));
    };
    const created = await run("create_invoice", {
      currency_code: "USD",
      invoice_number: "FS-2026A-r4730001",
      reference: "rc:7f3a91c2;run:r4730001",
      note: "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03",
      invoicer_email_address: BUSINESS_EMAIL,
      primary_recipients: [{ billing_info: { email_address: PAYER_EMAIL } }],
      items: [
        {
          name: "Premium",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "2887.50" },
          unit_of_measure: "AMOUNT",
        },
        {
          name: "Quality bonus",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "1386.00" },
          unit_of_measure: "AMOUNT",
        },
        {
          name: "Disbursement costs",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "60.00" },
          unit_of_measure: "AMOUNT",
        },
      ],
    });
    expect(created.rel).toBe("self");
    expect(created.href).toMatch(/^https:\/\/api\.sandbox\.paypal\.com\/v2\/invoicing\/invoices\/INV2-/);
    const invoiceId = String(created.href).split("/").pop() as string;
    const got = await run("get_invoice", { invoice_id: invoiceId });
    expect(got.id).toBe(invoiceId);
    expect(got.status).toBe("DRAFT");
    expect(got.amount.value).toBe("4333.50");

    const sent = await run("send_invoice", { invoice_id: invoiceId, send_to_recipient: false });
    expect(sent.rel).toBe("payer-view");
    const rules = await run(
      "create_conditional_rules_for_invoice",
      {
        invoice_id: invoiceId,
        rules: [
          {
            conditional_rule_type: "AUTO_CANCEL",
            rule_expiry_terms: {
              rule_expiry_condition: "SPECIFIC_DATE",
              condition_rule_end_date: plusDays(ptToday(sim.clock.now()), 7),
            },
          },
        ],
      },
      `cr-${invoiceId}`,
    );
    expect(rules.rules[0].conditional_rule_type).toBe("AUTO_CANCEL");
    const paid = await run("record_payment_for_invoice", {
      invoice_id: invoiceId,
      method: "BANK_TRANSFER",
      amount: { currency_code: "USD", value: "4333.50" },
      note: "Sandbox: marked as paid (simulated rail)",
    });
    expect(paid.payment_id).toMatch(/^EXTR-/);
    const found = await run("search_invoicing", {
      resource_type: "invoice",
      invoice_filters: { invoice_number: "FS-2026A-r4730001" },
    });
    expect(found.items).toHaveLength(1);
    expect(found.items[0].status).toBe("MARKED_AS_PAID");
    const dup = await run("create_invoice", {
      currency_code: "USD",
      invoice_number: "FS-2026A-r4730001",
      invoicer_email_address: BUSINESS_EMAIL,
      primary_recipients: [{ billing_info: { email_address: PAYER_EMAIL } }],
      items: [{ name: "Premium", quantity: "1", unit_amount: { currency_code: "USD", value: "1.00" } }],
    });
    expect(dup.ok ?? false).toBe(false);
    expect(JSON.stringify(dup)).toContain("422");
  });

  it("lets the toolkit's own PayPalClient fetch its token (Basic auth to api.sandbox.paypal.com)", async () => {
    // PayPalClient is not exported; reach the real class through an instance.
    const ClientClass = new PayPalAPI("unused", { sandbox: true }).paypalClient.constructor as new (args: {
      clientId: string;
      clientSecret: string;
      context: { sandbox: boolean };
    }) => InstanceType<typeof PayPalAPI>["paypalClient"];
    const client = new ClientClass({
      clientId: app().client_id,
      clientSecret: app().client_secret,
      context: { sandbox: true },
    });
    const before = Object.keys(sim.state.tokens).length;
    const api = new PayPalAPI(client, { sandbox: true });
    const out = JSON.parse(await api.run("get_invoice", { invoice_id: "INV2-AAAA-BBBB-CCCC-DDDD" }));
    expect(JSON.stringify(out)).toContain("404");
    expect(Object.keys(sim.state.tokens).length).toBe(before + 1);
  });

  it("runs @paypal/paypal-server-sdk TransactionSearchController unmodified", async () => {
    // Put something in the ledger: a two-item payout batch through the global fetch.
    const res = await fetch("https://api-m.sandbox.paypal.com/v1/payments/payouts", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(batchBody("2026A-sdk-r1", MEMBER_PAYOUTS.slice(0, 2))),
    });
    expect(res.status).toBe(201);
    await sim.idle();
    const client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: app().client_id,
        oAuthClientSecret: app().client_secret,
      },
      environment: Environment.Sandbox,
      timeout: BEYOND_TEST_TIMEOUT_MS, // in process: only vitest's testTimeout bounds it
    });
    const search = new TransactionSearchController(client);
    const now = sim.clock.now();
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    const result = await search.searchTransactions({
      startDate: iso(now - 86_400_000),
      endDate: iso(now + 60_000),
      fields: "all",
      pageSize: 500,
    });
    expect(result.statusCode).toBe(200);
    const details = result.result.transactionDetails ?? [];
    expect(details.map((d) => d.transactionInfo?.transactionEventCode)).toEqual(["T0001", "T0001"]);
    const balances = await search.searchBalances({ currencyCode: "USD" });
    expect(balances.statusCode).toBe(200);
    expect(balances.result.balances?.[0]?.availableBalance?.value).toBe("99872.34"); // 100000.00 − (64.45 + 62.71) − 2 × 0.25
  });

  it("matches node:http(s) hostnames whatever their case or a trailing dot: none reaches the network", async () => {
    // A local stand-in for the network: a request the interceptor missed resolves here (the `lookup` below) instead
    // of reaching PayPal's real sandbox. A rerouted request drops `lookup` and goes to the simulator's loopback.
    const reached: string[] = [];
    const network = createServer((req, res) => {
      reached.push(String(req.headers.host));
      res.end("network");
    });
    await new Promise<void>((r) => network.listen(0, "127.0.0.1", () => r()));
    const port = (network.address() as AddressInfo).port;
    const lookup = (
      _host: string,
      opts: { all?: boolean },
      cb: (err: Error | null, address: unknown, family?: number) => void,
    ) => (opts?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4));
    const basic = Buffer.from(`${app().client_id}:${app().client_secret}`).toString("base64");
    const send = (request: typeof httpRequest, options: RequestOptions) =>
      new Promise<{ status: number; simulated: string | null; body: string }>((resolve, reject) => {
        const req = request(
          {
            ...options,
            port,
            path: "/v1/oauth2/token",
            method: "POST",
            headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
            lookup: lookup as RequestOptions["lookup"],
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c: string) => {
              body += c;
            });
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                simulated: (res.headers["x-fairsplit-simulated"] as string | undefined) ?? null,
                body,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end("grant_type=client_credentials");
      });
    try {
      for (const options of [
        { hostname: "API-M.SANDBOX.PAYPAL.COM" },
        { hostname: "api-m.sandbox.paypal.com." },
        { hostname: "Api.Sandbox.PayPal.Com." },
        { host: "API-M.SANDBOX.PAYPAL.COM." },
      ] satisfies RequestOptions[]) {
        const r = await send(httpRequest, options);
        expect(r.simulated, JSON.stringify(options)).toBe("true");
        expect(r.status, JSON.stringify(options)).toBe(200);
        expect((JSON.parse(r.body) as { access_token: string }).access_token).toMatch(/^SIM\./);
      }
      expect(reached).toEqual([]);
      // a different host is still left alone (the stand-in answers it)
      const other = await send(httpRequest, { hostname: "api-m.sandbox.paypal.com.example" });
      expect(other.body).toBe("network");
      expect(reached).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => network.close(() => r()));
    }
  });

  it("the scoped Dispatcher matches a sandbox origin with a trailing dot too", async () => {
    const fellThrough: string[] = [];
    const fallback = {
      dispatch: (o: { origin?: string | URL }, handler: { onError?(err: Error): void }) => {
        fellThrough.push(String(o.origin));
        handler.onError?.(new Error("the network was reached"));
        return false;
      },
      close: async () => {},
      destroy: async () => {},
    };
    const dispatcher = createSandboxDispatcher(sim, { fallback });
    const res = await fetch("https://API-M.SANDBOX.PAYPAL.COM./v1/notifications/webhooks", {
      headers: { authorization: `Bearer ${accessToken}` },
      // @ts-expect-error -- undici extension of RequestInit
      dispatcher,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
    expect(fellThrough).toEqual([]);
  });

  it("also offers a scoped undici Dispatcher for fetch(url, { dispatcher })", async () => {
    const fallback = { dispatch: () => false, close: async () => {}, destroy: async () => {} };
    const dispatcher = createSandboxDispatcher(sim, { fallback });
    const res = await fetch("https://api-m.sandbox.paypal.com/v1/notifications/webhooks", {
      headers: { authorization: `Bearer ${accessToken}` },
      // @ts-expect-error -- undici extension of RequestInit
      dispatcher,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ webhooks: [] });
  });
});
