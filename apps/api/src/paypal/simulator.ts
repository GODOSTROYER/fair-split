// The in-process PayPal simulator (ADR-0002, ADR-0010): in PP_MODE=simulator without PP_SIM_URL, fs-api runs
// @fairsplit/paypal-sim inside its own process. This is the ONE file of any app that imports it
// (dependency-cruiser `paypal-sim-only-through-the-api-adapter`); everything else gets what it needs from here.
//
//   setupPayPalRail      creates the simulator and installs its process-wide interceptor, so the Agent Toolkit's
//                        axios (node:https) and any global fetch to PayPal's sandbox hosts reach it in process;
//                        fs-api's own rail sends its sandbox-host requests straight to `sim.apiFetch` (the REST
//                        routes only: no pages, no admin)
//   pages                `sim.publicFetch` alone, mounted at /paypal-sim (certificate chain, labelled invoice and
//                        pay pages, health). The REST API and /sim/admin are never mounted
//   trust                the simulator's cert URL pattern and CA, handed to the webhook verifier in this mode only
//                        (paypal-core `webhookSimulator`); a sandbox-mode rail never gets them
//   webhooks             one webhook registered at boot (all of fs-api's subscribed event types) to fs-api's own
//                        /webhooks/paypal; deliveries go to the host app's fetch in process, through the real route
//                        (RSA-SHA256 over the CRC32, the cert URL pattern, the 5-minute window, transmission-id
//                        dedupe). Its id is the rail's webhook id: the simulator mints it fresh on every boot
//   state                in memory, reset by every restart or redeploy (no snapshot on Render's disk); the duplicate
//                        delivery toggle is on (MM-6's resent copy); Rhea Jumawan (M-031) has no account, so her
//                        item parks UNCLAIMED; the co-op's business account opens with SIMULATED_BUSINESS_BALANCE_USD
//
// PP_* default to the committed simulator registry's `fs-judge` REST app and accounts
// (packages/paypal-sim/data/accounts.json): public, fictional values that only this simulator accepts.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type SimulatorWebhookTrust, WEBHOOK_EVENT_TYPES } from "@fairsplit/paypal-core";
import {
  loadRegistry,
  type Registry,
  type PayPalRail as SimPayPalRail,
  type SimulatorOptions,
  setupPayPalRail,
} from "@fairsplit/paypal-sim";
import type { ApiEnv } from "../env.js";
import type { InProcessSimulator } from "./mode.js";

/** Where fs-api mounts the simulator's public pages. */
export const SIMULATOR_BASE_PATH = "/paypal-sim";
/** The registry's REST app fs-api uses by default (the hosted judge's). */
export const SIMULATOR_APP = "fs-judge";
/** fs-api's own webhook route, where the simulator delivers. */
export const SIMULATOR_WEBHOOK_PATH = "/webhooks/paypal";
/**
 * The co-op's simulated opening balance (the registry says US$100,000). Judge Mode's daily live posts are
 * min(40, (balance − US$10,000) / (US$345 × days left)): at US$100,000 that is 5 a day, a public third of 1, so
 * nearly every session would replay. US$1,000,000 keeps the cap at 40 to 15 Dec. Simulated money, labelled.
 */
export const SIMULATED_BUSINESS_BALANCE_USD = "1000000.00";

/** The PP_* values the in-process simulator answers to (all public simulator values, never PayPal's). */
export interface SimulatorPayPalDefaults {
  clientId: string;
  clientSecret: string;
  businessEmail: string;
  payerEmail: string;
  /** PP_RECEIVERS: member number → simulator account e-mail, as JSON. */
  receivers: string;
  /** PP_UNCLAIMED_RECEIVER: the member with no simulator account (Rhea, M-031). */
  unclaimedReceiver: string;
}

/**
 * Whether this env runs the simulator in process: simulator mode with no PP_SIM_URL (a remote simulator, or the
 * sandbox, is reached over the network instead).
 */
export function runsInProcessSimulator(paypal: ApiEnv["paypal"]): boolean {
  return paypal.mode === "simulator" && !paypal.simUrl;
}

/**
 * A file of the simulator package (its vendored specs, its registry), resolved through the package's entry. The
 * bundle (dist/) inlines the package, so the package's own `import.meta.url` defaults would point into apps/api/dist;
 * Node still resolves `@fairsplit/paypal-sim` to packages/paypal-sim/src/index.ts through apps/api's node_modules.
 * Undefined when that cannot be resolved here (the package's defaults then apply, as in the source tree).
 */
function packageFile(relative: string): string | undefined {
  try {
    const file = fileURLToPath(new URL(relative, import.meta.resolve("@fairsplit/paypal-sim")));
    return existsSync(file) ? file : undefined;
  } catch {
    return undefined;
  }
}

function registryOf(accountsFile?: string): Registry {
  return loadRegistry(accountsFile ?? packageFile("../data/accounts.json"));
}

/** The registry's `fs-judge` app, its co-op, Lantern Bay, the seven members with accounts, and Rhea. */
export function simulatorPayPalDefaults(registry: Registry = registryOf()): SimulatorPayPalDefaults {
  const app = registry.apps.find((a) => a.name === SIMULATOR_APP);
  if (!app) throw new Error(`the simulator registry has no ${SIMULATOR_APP} REST app`);
  const business = registry.accounts.find((a) => a.key === app.account);
  const payer = registry.accounts.find((a) => a.role === "payer");
  const rhea = registry.unregistered_receivers[0];
  if (!business || !payer || !rhea)
    throw new Error("the simulator registry lacks the co-op, the payer or Rhea");
  const receivers: Record<string, string> = {};
  for (const a of registry.accounts) {
    if (a.role === "payout_receiver" && a.member_no) receivers[a.member_no] = a.email;
  }
  return {
    clientId: app.client_id,
    clientSecret: app.client_secret,
    businessEmail: business.email,
    payerEmail: payer.email,
    receivers: JSON.stringify(receivers),
    unclaimedReceiver: rhea.email,
  };
}

/** `env.paypal` with every unset PP_* filled from the simulator registry (in-process simulator mode only). */
export function withSimulatorDefaults(
  paypal: ApiEnv["paypal"],
  defaults: SimulatorPayPalDefaults = simulatorPayPalDefaults(),
): ApiEnv["paypal"] {
  if (!runsInProcessSimulator(paypal)) return paypal;
  return {
    ...paypal,
    clientId: paypal.clientId ?? defaults.clientId,
    clientSecret: paypal.clientSecret ?? defaults.clientSecret,
    businessEmail: paypal.businessEmail ?? defaults.businessEmail,
    payerEmail: paypal.payerEmail ?? defaults.payerEmail,
    receivers: paypal.receivers ?? defaults.receivers,
    unclaimedReceiver: paypal.unclaimedReceiver ?? defaults.unclaimedReceiver,
  };
}

/** The registry with the co-op's (the configured app's account's) USD balance raised (see the constant). */
function fundedRegistry(registry: Registry, clientId: string, balanceUsd: string): Registry {
  const app = registry.apps.find((a) => a.client_id === clientId);
  return {
    ...registry,
    accounts: registry.accounts.map((a) =>
      app && a.key === app.account ? { ...a, balances: { ...a.balances, USD: balanceUsd } } : a,
    ),
  };
}

/** What a host app needs from the running simulator. */
export interface InProcessPayPalSimulator {
  /** For `createPayPalRail({ simulator })`: the REST routes, the public pages and the webhook trust. */
  readonly rail: InProcessSimulator;
  /** The webhook registered at this boot (fs-api's PP_WEBHOOK_ID in this mode). */
  readonly webhookId: string;
  /** Hands deliveries to the host app's own fetch, in process (call it once the app exists). */
  deliverTo(fetch: (request: Request) => Promise<Response> | Response): void;
  /** Waits until queued processing and webhook deliveries have finished (tests, the smoke). */
  idle(timeoutMs?: number): Promise<void>;
  /** Every response or event the simulator found off its vendored spec (tests assert it stays empty). */
  readonly violations: readonly string[];
  stop(): Promise<void>;
}

export interface StartSimulatorOptions {
  /** env.paypal with the simulator's defaults applied (`withSimulatorDefaults`). */
  paypal: ApiEnv["paypal"];
  /** fs-api's public origin: the cert URL, the pay pages and the webhook target live on it. */
  publicOrigin: string;
  /** The SIM_* tuning variables (SIM_SPEED, SIM_LATENCY_MS, …), read by the simulator itself. */
  source?: Readonly<Record<string, string | undefined>>;
  /** fs-api's clock, so signing times and the verifier's 5-minute window agree (tests pass their fake clock). */
  now?: () => number;
  /** Processing delays × speed (default 1, about real seconds; 0 runs everything on the next tick). */
  speed?: number;
  /** The duplicate-delivery toggle (default on: every event is delivered twice, MM-6's resent copy). */
  duplicate?: boolean;
  /** The co-op's opening USD balance (default SIMULATED_BUSINESS_BALANCE_USD). */
  businessBalanceUsd?: string;
  log?: (level: "info" | "warn", message: string) => void;
}

/** Fetches a token and registers fs-api's webhook through the simulator's REST routes (as tools/setup-webhooks.ts). */
async function registerWebhook(
  rail: SimPayPalRail,
  o: { clientId: string; clientSecret: string; url: string },
): Promise<string> {
  const sim = rail.simulator;
  if (!sim) throw new Error("no simulator to register the webhook with");
  const api = "https://api-m.sandbox.paypal.com";
  const basic = Buffer.from(`${o.clientId}:${o.clientSecret}`).toString("base64");
  const tokenRes = await sim.apiFetch(
    new Request(`${api}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }),
  );
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!tokenRes.ok || !token.access_token) throw new Error(`simulator token: HTTP ${tokenRes.status}`);
  const res = await sim.apiFetch(
    new Request(`${api}/v1/notifications/webhooks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: o.url, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) }),
    }),
  );
  const body = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !body.id)
    throw new Error(`simulator webhook registration: HTTP ${res.status} ${body.message ?? ""}`);
  return body.id;
}

/**
 * Starts the simulator in this process (one per process: the interceptor is process-wide) and registers fs-api's
 * webhook. Throws when it cannot start; the server turns that into a boot refusal.
 */
export async function startInProcessSimulator(o: StartSimulatorOptions): Promise<InProcessPayPalSimulator> {
  const clientId = o.paypal.clientId;
  const clientSecret = o.paypal.clientSecret;
  if (!clientId || !clientSecret)
    throw new Error("the in-process simulator needs PP_CLIENT_ID and PP_CLIENT_SECRET");
  const origin = new URL(o.publicOrigin).origin;
  const webhookUrl = `${origin}${SIMULATOR_WEBHOOK_PATH}`;
  let deliver: ((request: Request) => Promise<Response> | Response) | null = null;
  const deliveryFetch = async (url: string, init: RequestInit): Promise<Response> => {
    const target = new URL(url);
    if (target.origin === origin && target.pathname === SIMULATOR_WEBHOOK_PATH) {
      // fs-api's own route, in process: the same verification and storage a delivery from PayPal meets
      if (!deliver) throw new Error("fs-api is not ready for simulator deliveries yet");
      return deliver(new Request(url, init));
    }
    return globalThis.fetch(url, init);
  };
  const simEnv: Record<string, string | undefined> = { PP_MODE: "simulator", PP_CLIENT_ID: clientId };
  for (const [k, v] of Object.entries(o.source ?? {})) if (k.startsWith("SIM_")) simEnv[k] = v;
  const specDir = packageFile("../spec/");
  const overrides: SimulatorOptions = {
    publicBaseUrl: origin,
    basePath: SIMULATOR_BASE_PATH,
    registry: fundedRegistry(registryOf(), clientId, o.businessBalanceUsd ?? SIMULATED_BUSINESS_BALANCE_USD),
    dataDir: null,
    persist: false,
    deliveryFetch,
    delivery: { duplicate: o.duplicate ?? true, outOfOrder: false },
    ...(specDir ? { specDir } : {}),
    ...(o.speed !== undefined ? { speed: o.speed } : {}),
    ...(o.now ? { now: o.now } : {}),
    logger: (m) => o.log?.(m.startsWith("CONTRACT VIOLATION") ? "warn" : "info", m),
  };
  const sim = await setupPayPalRail(simEnv as NodeJS.ProcessEnv, overrides);
  const simulator = sim.simulator;
  if (!simulator || !sim.publicFetch || !sim.certUrlPattern) {
    await sim.stop();
    throw new Error("the simulator did not start in simulator mode");
  }
  let webhookId: string;
  try {
    webhookId = await registerWebhook(sim, { clientId, clientSecret, url: webhookUrl });
  } catch (err) {
    await sim.stop();
    throw err;
  }
  const publicFetch = sim.publicFetch;
  const trust: SimulatorWebhookTrust = {
    certUrlPattern: sim.certUrlPattern,
    trustAnchors: [simulator.signing.ca.toString()],
  };
  let stopped = false;
  return {
    rail: {
      name: "paypal-sim (in process)",
      fetch: (request) => simulator.apiFetch(request),
      pages: { basePath: SIMULATOR_BASE_PATH, baseUrl: simulator.pagesBaseUrl, fetch: publicFetch },
      webhookTrust: trust,
    },
    webhookId,
    deliverTo(fetch) {
      deliver = fetch;
    },
    idle: (timeoutMs) => simulator.idle(timeoutMs),
    get violations() {
      return simulator.violations;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      deliver = null;
      await sim.stop();
    },
  };
}
