// The in-process simulator rail (ADR-0002, ADR-0010), wired exactly as the server wires it (paypal/simulator.ts), with
// no msw: PP_* default to the committed fs-judge app; the simulator's interceptor catches the Agent Toolkit's axios
// calls and any global fetch to PayPal's sandbox hosts; fs-api's own rail reaches its REST routes in process; its
// signing trust reaches the webhook verifier in simulator mode only; /paypal-sim serves its public pages and nothing
// else (no REST API, no admin).
import { createMemoryLimiter } from "@fairsplit/paypal-core";
import { createTk, ToolkitError } from "@fairsplit/paypal-toolkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";
import { createTestApp, TEST_ENV, type TestApp } from "../test/index.js";
import { createPayPalRail, type PayPalRail } from "./mode.js";
import {
  runsInProcessSimulator,
  SIMULATED_BUSINESS_BALANCE_USD,
  simulatorPayPalDefaults,
  withSimulatorDefaults,
} from "./simulator.js";
import { startSimApp, startTestSimulator, type TestSimulator } from "./test/sim.js";

const SANDBOX = "https://api-m.sandbox.paypal.com";

let s: TestSimulator;
let t: TestApp;
let rail: PayPalRail;

beforeAll(async () => {
  s = await startTestSimulator({ duplicate: false });
  t = await startSimApp(s);
  rail = t.deps.paypal;
});
afterAll(async () => {
  await t?.close();
  expect(s.sim.violations).toEqual([]);
  await s?.sim.stop();
});

/** One simulated payout to M-014, through fs-api's rail (PayPalHttp → sim.apiFetch); its deliveries are captured. */
async function payOneAndCapture(senderBatchId: string): Promise<{ deliveries: Request[]; batchId: string }> {
  const captured: Request[] = [];
  s.sim.deliverTo(async (request) => {
    captured.push(request.clone());
    return new Response(null, { status: 200 });
  });
  const r = await rail.core.http.request<{ batch_header: { payout_batch_id: string } }>({
    method: "POST",
    path: "/v1/payments/payouts",
    requestId: `test-${senderBatchId}`,
    purpose: "payouts.create",
    priority: "background",
    body: {
      sender_batch_header: { sender_batch_id: senderBatchId, email_subject: "Fair Split test (simulated)" },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: "1.00", currency: "USD" },
          receiver: "consolacion.bacus@example.org",
          sender_item_id: `${senderBatchId}-M014`,
        },
      ],
    },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error("the payout failed");
  await s.sim.idle();
  s.sim.deliverTo((request) => t.app.fetch(request));
  return { deliveries: captured, batchId: r.body.batch_header.payout_batch_id };
}

describe("PP_* defaults: the committed simulator registry's fs-judge app", () => {
  it("fills every unset PP_* from data/accounts.json, Rhea (M-031) as the receiver with no account", () => {
    const d = simulatorPayPalDefaults();
    expect(d).toMatchObject({
      clientId: "SIM-fs-judge-client",
      businessEmail: "bulawanon.coop@example.org",
      payerEmail: "lantern.bay.payables@example.org",
      unclaimedReceiver: "rhea.jumawan@example.org",
    });
    const receivers = JSON.parse(d.receivers) as Record<string, string>;
    expect(Object.keys(receivers).sort()).toEqual([
      "M-002",
      "M-007",
      "M-014",
      "M-018",
      "M-022",
      "M-039",
      "M-060",
    ]);
    expect(Object.values(receivers)).not.toContain("rhea.jumawan@example.org");
    const paypal = withSimulatorDefaults(parseEnv({ ...TEST_ENV }).paypal);
    expect(paypal).toMatchObject({ clientId: d.clientId, receivers: d.receivers });
  });

  it("only in simulator mode without PP_SIM_URL: set values and the other modes are left alone", () => {
    const own = parseEnv({ ...TEST_ENV, PP_BUSINESS_EMAIL: "coop-own@example.org" }).paypal;
    expect(withSimulatorDefaults(own).businessEmail).toBe("coop-own@example.org");
    const remote = parseEnv({ ...TEST_ENV, PP_SIM_URL: "http://127.0.0.1:4010" }).paypal;
    expect(runsInProcessSimulator(remote)).toBe(false);
    expect(withSimulatorDefaults(remote)).toEqual(remote);
    const sandbox = parseEnv({
      ...TEST_ENV,
      PP_MODE: "sandbox",
      PP_CLIENT_ID: "test-client",
      PP_CLIENT_SECRET: "test-secret",
      PP_WEBHOOK_ID: "WH-TEST",
    }).paypal;
    expect(runsInProcessSimulator(sandbox)).toBe(false);
    expect(withSimulatorDefaults(sandbox)).toEqual(sandbox);
  });
});

describe("the simulator's interceptor and fs-api's rail reach the simulator in process", () => {
  it("the Agent Toolkit's axios calls (api.sandbox.paypal.com over node:https) are answered by the simulator", async () => {
    const calls: { status: number | null; debugId: string | null }[] = [];
    const tk = createTk({
      auth: rail.core.auth,
      limiter: createMemoryLimiter(),
      onCall: (c) => {
        calls.push({ status: c.status, debugId: c.debugId });
      },
    });
    // PayPal's own sandbox would answer 401 to a simulator token; the simulator knows the token and the invoice does
    // not exist: a 404 with its own `sim-` debug id
    const err = await tk("get_invoice", { invoice_id: "INV2-SIMX-TEST-NONE-0000" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolkitError);
    expect(err).toMatchObject({ status: 404 });
    expect((err as ToolkitError).debugId).toMatch(/^sim-[0-9a-f]{12}$/);
    expect(calls.at(-1)).toMatchObject({ status: 404 });
  });

  it("a global fetch to the sandbox host is answered by the simulator (labelled x-fairsplit-simulated)", async () => {
    const d = simulatorPayPalDefaults();
    const basic = Buffer.from(`${d.clientId}:${d.clientSecret}`).toString("base64");
    const res = await fetch(`${SANDBOX}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
    expect(((await res.json()) as { access_token: string }).access_token).toMatch(/^SIM\./);
  });

  it("fs-api's PayPalHttp reaches the REST routes: the co-op's simulated balance is the raised opening", async () => {
    const r = await rail.core.http.request<{
      balances: { currency: string; available_balance: { value: string } }[];
    }>({
      method: "GET",
      path: "/v1/reporting/balances",
      query: { currency_code: "USD" },
      purpose: "reporting.balances",
      priority: "background",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.balances.find((b) => b.currency === "USD")?.available_balance.value).toBe(
      SIMULATED_BUSINESS_BALANCE_USD,
    );
    expect(rail.describe()).toMatchObject({
      mode: "simulator",
      label: "simulated",
      provenance: "simulated_rail",
      simulator: { kind: "in_process" },
      credentials: "configured",
      webhookId: "configured",
    });
  });
});

describe("webhook trust: the simulator's cert URL and CA in simulator mode only", () => {
  it("a simulator-signed delivery verifies on the simulator rail and is refused on a sandbox rail", async () => {
    const { deliveries } = await payOneAndCapture("SIMTRUST-1");
    expect(deliveries.length).toBeGreaterThan(0);
    const first = deliveries[0] as Request;
    const body = await first.clone().text();
    expect(first.url).toBe(`${TEST_ENV.PUBLIC_ORIGIN}/webhooks/paypal`);
    expect(first.headers.get("paypal-cert-url")).toMatch(
      /^http:\/\/localhost:8787\/paypal-sim\/sim\/certs\/SIMCERT-[0-9a-f-]+\.pem$/,
    );
    const ok = await rail.core.verifier.verifyDetailed(body, first.headers, rail.webhookId ?? "");
    expect(ok).toMatchObject({ mode: "self", reason: null });

    // the same simulator handed to a sandbox-mode rail: no trust, no pages, refused before any fetch
    const sandbox = createPayPalRail({
      paypal: parseEnv({
        ...TEST_ENV,
        PP_MODE: "sandbox",
        PP_CLIENT_ID: "test-client",
        PP_CLIENT_SECRET: "test-secret",
        PP_WEBHOOK_ID: rail.webhookId ?? "",
      }).paypal,
      limiter: createMemoryLimiter(),
      now: () => s.clock.nowMs(),
      simulator: s.sim.rail,
    });
    expect(sandbox.pages).toBeNull();
    expect(sandbox.simulator).toBeNull();
    const refused = await sandbox.core.verifier.verifyDetailed(body, first.headers, rail.webhookId ?? "");
    // PayPal's structural check: here the local http origin fails first (NOT_HTTPS); on a host, HOST_NOT_PAYPAL
    expect(refused).toMatchObject({ mode: false, reason: "CERT_URL_REJECTED" });
    expect(["NOT_HTTPS", "HOST_NOT_PAYPAL"]).toContain(refused.detail);
  });
});

describe("/paypal-sim: the simulator's public pages, never its REST API or admin", () => {
  it("serves health and the certificate chain every delivery names", async () => {
    const health = await t.json<{ ok: boolean; simulated: boolean; cert_url: string }>(
      "/paypal-sim/sim/health",
    );
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, simulated: true });
    const certPath = new URL(health.body.cert_url).pathname;
    expect(certPath).toMatch(/^\/paypal-sim\/sim\/certs\/SIMCERT-/);
    const cert = await t.request(certPath);
    expect(cert.status).toBe(200);
    expect(cert.headers.get("content-type")).toBe("application/x-pem-file");
    expect(await cert.text()).toContain("BEGIN CERTIFICATE");
  });

  it.each([
    ["GET", "/paypal-sim/sim/admin/state"],
    ["GET", "/paypal-sim/sim/admin/accounts"],
    ["POST", "/paypal-sim/sim/admin/reset"],
    ["POST", "/paypal-sim/sim/admin/delivery"],
    ["POST", "/paypal-sim/sim/admin/clock"],
    ["GET", "/sim/admin/state"],
    ["POST", "/paypal-sim/v1/oauth2/token"],
    ["GET", "/paypal-sim/v1/notifications/webhooks"],
    ["POST", "/paypal-sim/v1/payments/payouts"],
  ])("%s %s answers 404 or 403 and changes nothing", async (method, path) => {
    const r = await t.request(path, {
      method,
      headers: { "content-type": "application/json", host: "localhost:8787" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    expect([403, 404]).toContain(r.status);
    const text = await r.text();
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("client_secret");
  });

  it("an admin reset through the mount resets nothing: a batch paid before still answers", async () => {
    const { batchId } = await payOneAndCapture("SIMTRUST-2");
    const admin = await t.request("/paypal-sim/sim/admin/reset", { method: "POST" });
    expect(admin.status).toBe(404);
    const found = await rail.core.http.request<{
      batch_header: { payout_batch_id: string; batch_status: string };
    }>({
      method: "GET",
      path: `/v1/payments/payouts/${batchId}`,
      purpose: "payouts.get",
      priority: "background",
    });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.body.batch_header).toMatchObject({ payout_batch_id: batchId, batch_status: "SUCCESS" });
    }
  });

  it("a sandbox-mode app mounts nothing at /paypal-sim", async () => {
    const sandbox = await createTestApp({
      env: {
        PP_MODE: "sandbox",
        PP_CLIENT_ID: "test-client",
        PP_CLIENT_SECRET: "test-secret",
        PP_WEBHOOK_ID: "WH-X",
      },
      simulator: s.sim.rail,
    });
    try {
      expect(sandbox.deps.paypal.pages).toBeNull();
      expect((await sandbox.request("/paypal-sim/sim/health")).status).toBe(404);
    } finally {
      await sandbox.close();
    }
  });
});
