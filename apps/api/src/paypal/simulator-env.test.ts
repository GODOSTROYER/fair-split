// The in-process simulator takes only its tuning SIM_* variables from the environment (paypal/simulator.ts,
// SIMULATOR_TUNING_VARIABLES). Where its links point (SIM_API_BASE_URL), where it may deliver (SIM_WEBHOOK_ORIGINS),
// whether it checks the contract (SIM_STRICT), its admin API (SIM_ADMIN_TOKEN) and the rest are fs-api's to fix in
// process mode: a set value is ignored, named (never echoed) in one boot warning. Its own file: the simulator's
// interceptor is process-wide, so this file starts the one simulator of its process with a hostile environment.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";
import { TEST_ENV } from "../test/index.js";
import {
  type InProcessPayPalSimulator,
  SIMULATOR_TUNING_VARIABLES,
  simulatorTuningEnv,
  startInProcessSimulator,
  withSimulatorDefaults,
} from "./simulator.js";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const EVIL = "https://sim-target.example";
/** Every SIM_* variable fs-api fixes in process mode, each set to something an operator should never get. */
const HOSTILE: Record<string, string> = {
  SIM_API_BASE_URL: EVIL,
  SIM_WEBHOOK_ORIGINS: EVIL,
  SIM_STRICT: "0",
  SIM_STRICT_PROPERTIES: "1",
  SIM_ADMIN_TOKEN: "sim-admin-for-tests",
  SIM_TRUST_PROXY: "1",
  SIM_PUBLIC_URL: EVIL,
  SIM_BASE_PATH: "/elsewhere",
  SIM_DATA_DIR: ".",
  SIM_PERSIST: "1",
  SIM_ACCOUNTS_FILE: "accounts.json",
  SIM_ALLOW_LOOPBACK_WEBHOOKS: "1",
  SIM_OUT_OF_ORDER: "1",
  SIM_DUPLICATE_DELIVERY: "1",
  SIM_IDEMPOTENCY: "all-posts",
};

describe("simulatorTuningEnv: an explicit allowlist of SIM_* variables", () => {
  it("passes the tuning variables and names (never echoes) every other SIM_* setting", () => {
    const tuning = Object.fromEntries(SIMULATOR_TUNING_VARIABLES.map((k) => [k, "1"]));
    const r = simulatorTuningEnv({ ...tuning, ...HOSTILE, PATH: "/bin", PP_MODE: "simulator" });
    expect(r.env).toEqual(tuning);
    expect(r.ignored).toEqual(Object.keys(HOSTILE).sort());
    expect(JSON.stringify(r.ignored)).not.toContain(EVIL);
  });

  it("allows exactly the tuning variables ADR-0010 names (pace, latency, the modelled limit, fees, lag)", () => {
    expect([...SIMULATOR_TUNING_VARIABLES].sort()).toEqual([
      "SIM_INVOICE_FEE_BPS",
      "SIM_INVOICE_FEE_CENTS",
      "SIM_LATENCY_MS",
      "SIM_PAYOUT_FEE_CENTS",
      "SIM_RATE_LIMIT_BLOCK_S",
      "SIM_RATE_LIMIT_PER_MIN",
      "SIM_REPORTING_LAG_S",
      "SIM_SPEED",
    ]);
  });
});

describe("startInProcessSimulator ignores the SIM_* settings fs-api fixes", () => {
  const logs: { level: string; message: string }[] = [];
  let sim: InProcessPayPalSimulator;
  const paypal = withSimulatorDefaults(parseEnv({ ...TEST_ENV }).paypal);

  beforeAll(async () => {
    sim = await startInProcessSimulator({
      paypal,
      publicOrigin: TEST_ENV.PUBLIC_ORIGIN as string,
      source: { ...HOSTILE, SIM_LATENCY_MS: "0" },
      speed: 0,
      log: (level, message) => logs.push({ level, message }),
    });
  });
  afterAll(async () => {
    await sim?.stop();
  });

  async function token(): Promise<string> {
    const basic = Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString("base64");
    const res = await sim.rail.fetch(
      new Request(`${SANDBOX}/v1/oauth2/token`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      }),
    );
    return ((await res.json()) as { access_token: string }).access_token;
  }

  it("says once, at warn, which settings it ignored, by name only", () => {
    const warned = logs.filter((l) => l.level === "warn" && l.message.includes("SIM_"));
    expect(warned).toHaveLength(1);
    for (const name of Object.keys(HOSTILE)) expect(warned[0]?.message).toContain(name);
    expect(warned[0]?.message).not.toContain(EVIL);
    expect(warned[0]?.message).not.toContain(HOSTILE.SIM_ADMIN_TOKEN);
  });

  it("SIM_WEBHOOK_ORIGINS adds no delivery target: a webhook to that origin is refused", async () => {
    const res = await sim.rail.fetch(
      new Request(`${SANDBOX}/v1/notifications/webhooks`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({
          url: `${EVIL}/webhooks/paypal`,
          event_types: [{ name: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" }],
        }),
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("SIM_API_BASE_URL moves no link: the event resources link to PayPal's sandbox API", async () => {
    const captured: string[] = [];
    sim.deliverTo(async (request) => {
      captured.push(await request.text());
      return new Response(null, { status: 200 });
    });
    const res = await sim.rail.fetch(
      new Request(`${SANDBOX}/v1/payments/payouts`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await token()}`,
          "content-type": "application/json",
          "paypal-request-id": "simenv-test-1",
        },
        body: JSON.stringify({
          sender_batch_header: { sender_batch_id: "SIMENV-1", email_subject: "Fair Split test (simulated)" },
          items: [
            {
              recipient_type: "EMAIL",
              amount: { value: "1.00", currency: "USD" },
              receiver: "consolacion.bacus@example.org",
              sender_item_id: "SIMENV-1-M014",
            },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);
    await sim.idle();
    expect(captured.length).toBeGreaterThan(0);
    for (const body of captured) {
      expect(body).not.toContain(EVIL);
      expect(body).toContain("sandbox.paypal.com");
    }
  });

  it("SIM_ADMIN_TOKEN opens no admin API on the mount", async () => {
    const pages = sim.rail.pages;
    if (!pages) throw new Error("no pages");
    const r = await pages.fetch(
      new Request(`${pages.baseUrl}/sim/admin/state`, {
        headers: { authorization: `Bearer ${HOSTILE.SIM_ADMIN_TOKEN}` },
      }),
    );
    expect([403, 404]).toContain(r.status);
  });
});
