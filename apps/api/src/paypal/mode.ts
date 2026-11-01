// The PayPal mode seam (ADR-0002): `PP_MODE=simulator` (default until sandbox credentials exist) or
// `PP_MODE=sandbox`. Everything above this file is identical in both modes: the same paypal-core OAuth,
// PayPalHttp and webhook verifier, the same toolkit and payouts code, the same sandbox base URL. Only the
// transport differs: in simulator mode requests to PayPal's sandbox hosts are routed to the simulator.
//
//   simulator + PP_SIM_URL   → a running @fairsplit/paypal-sim (`tools/paypal-sim.ts`, WS-PPSIM)
//   simulator, no PP_SIM_URL → the server runs paypal-sim IN PROCESS (./simulator.ts, ADR-0010) and passes it here
//                              as `simulator`; without one (tests, `createTestApp()`) the labelled STUB below
//                              answers every PayPal call with 503 SIMULATOR_NOT_RUNNING
//   sandbox                  → the real api-m.sandbox.paypal.com
//
// I8: whatever the mode, everything derived from PayPal carries `rail.provenance` (`simulated_rail` or `live`)
// and every API response carries the `X-FS-Rail` header (`simulated` | `sandbox`). A Judge Mode step decided
// replay runs on a REPLAY rail derived from this one (paypal/replay.ts): provenance `replay`, no network.
// An in-process simulator also brings its public pages (served at /paypal-sim, and answered here in process for the
// webhook verifier's certificate fetch) and its webhook signing trust, which the verifier gets in simulator mode only:
// a sandbox-mode rail never trusts the simulator's certificate URL or CA.
import {
  createPayPalCore,
  type FetchLike,
  type LoggerLike,
  PAYPAL_API_BASE_URL,
  PAYPAL_API_HOSTS,
  type PayPalCallRecorder,
  type PayPalCore,
  type PayPalLimiter,
  type SimulatorWebhookTrust,
  type TransmissionStore,
} from "@fairsplit/paypal-core";
import type { ApiEnv, PayPalMode } from "../env.js";

export type RailLabel = "simulated" | "sandbox";
/** `replay` only on a Judge Mode replay rail (paypal/replay.ts), never on the rail a request is served on. */
export type RailProvenance = "simulated_rail" | "live" | "replay";

/** How simulator traffic is served. */
export type SimulatorTransport =
  | { kind: "stub" }
  | { kind: "remote"; url: string }
  | { kind: "in_process"; name: string };

export interface PayPalRail {
  readonly mode: PayPalMode;
  /** The word the UI and the `X-FS-Rail` header use. */
  readonly label: RailLabel;
  /** I8 provenance for every PayPal-derived row and event. */
  readonly provenance: RailProvenance;
  /** Always the sandbox base URL: switching modes never changes a request. */
  readonly baseUrl: string;
  /** Transport for PayPal requests (routes sandbox hosts to the simulator in simulator mode). */
  readonly fetch: FetchLike;
  readonly simulator: SimulatorTransport | null;
  /** OAuth, PayPalHttp and the webhook verifier, wired to the shared limiter and recorder. */
  readonly core: PayPalCore;
  readonly webhookId: string | null;
  /**
   * The in-process simulator's public pages (mounted at `basePath`: certificate chain, labelled invoice and pay
   * pages, health; never its REST API or admin). Null on every other rail.
   */
  readonly pages: SimulatorPages | null;
  /** For /readyz and /ops: no secrets. */
  describe(): RailDescription;
}

export interface SimulatorPages {
  /** The mount, e.g. `/paypal-sim`. */
  readonly basePath: string;
  /** `{public origin}{basePath}`: where the simulator's certificate and pay-page URLs point. */
  readonly baseUrl: string;
  /**
   * The certificate this simulator signs every delivery with (`{baseUrl}/sim/certs/SIMCERT-….pem`, new each boot):
   * the boot loads it into the webhook verifier before the server takes traffic (paypal/boot.ts).
   */
  readonly certUrl?: string;
  fetch(request: Request): Promise<Response>;
}

export interface RailDescription {
  mode: PayPalMode;
  label: RailLabel;
  /** The configured rail's (a replay rail describes the rail it replays on). */
  provenance: Exclude<RailProvenance, "replay">;
  simulator: SimulatorTransport | null;
  credentials: "configured" | "placeholder";
  webhookId: "configured" | "missing";
}

/** A fetch-compatible simulator handler (paypal-sim's Hono app exposes one). */
export interface InProcessSimulator {
  name: string;
  /** PayPal's REST routes (what the sandbox hosts answer). */
  fetch(request: Request): Promise<Response>;
  /** The simulator's public pages, when it has any (./simulator.ts: paypal-sim's `publicFetch`). */
  pages?: SimulatorPages;
  /** Its webhook signing trust: the verifier gets it in simulator mode only (ADR-0010). */
  webhookTrust?: SimulatorWebhookTrust;
}

export interface CreateRailOptions {
  paypal: ApiEnv["paypal"];
  limiter: PayPalLimiter;
  recorder?: PayPalCallRecorder;
  logger?: LoggerLike;
  /** The network fetch (default: global fetch, resolved per call so msw interceptors apply). */
  fetch?: FetchLike;
  /** Plug an in-process simulator instead of PP_SIM_URL or the stub. */
  simulator?: InProcessSimulator;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Extra webhook trust anchors (the simulator's CA in simulator mode; test CAs in tests). */
  webhookTrustAnchors?: readonly string[];
  webhookTransmissionStore?: TransmissionStore;
}

/** Placeholder REST credentials for simulator mode, so no real secret is ever needed there. */
export const SIMULATOR_CLIENT = { clientId: "fs-sim-client", clientSecret: "fs-sim-secret" } as const;

export function createPayPalRail(o: CreateRailOptions): PayPalRail {
  const mode = o.paypal.mode;
  const network: FetchLike = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let simulator: SimulatorTransport | null = null;
  let transport: FetchLike = network;
  let pages: SimulatorPages | null = null;
  let webhookSimulator: SimulatorWebhookTrust | undefined;
  if (mode === "simulator") {
    const sim = o.simulator;
    if (sim) {
      simulator = { kind: "in_process", name: sim.name };
      pages = sim.pages ?? null;
      webhookSimulator = sim.webhookTrust;
      // the simulator's own pages (the webhook certificate) are answered in process too, never over the network
      const local = pages ? routeToPages(network, pages) : network;
      transport = routeToSimulator(local, (req) => sim.fetch(req));
    } else if (o.paypal.simUrl) {
      const base = o.paypal.simUrl.replace(/\/+$/, "");
      simulator = { kind: "remote", url: base };
      transport = routeToSimulator(network, (req) => {
        const u = new URL(req.url);
        return network(`${base}${u.pathname}${u.search}`, requestInit(req));
      });
    } else {
      simulator = { kind: "stub" };
      transport = routeToSimulator(network, async (req) => stubResponse(req));
    }
  }

  const placeholder = mode === "simulator" && (!o.paypal.clientId || !o.paypal.clientSecret);
  const core = createPayPalCore({
    config: {
      clientId: placeholder ? SIMULATOR_CLIENT.clientId : (o.paypal.clientId ?? ""),
      clientSecret: placeholder ? SIMULATOR_CLIENT.clientSecret : (o.paypal.clientSecret ?? ""),
      devMocks: o.paypal.devMocks,
      // PP_CERT_ALLOW: pinned PayPal cert ids draw on the fetches held back for known ids, so a flood of forged
      // deliveries naming new cert URLs cannot starve the real one.
      knownCertIds: o.paypal.knownCertIds,
    },
    limiter: o.limiter,
    ...(o.recorder ? { recorder: o.recorder } : {}),
    ...(o.logger ? { logger: o.logger } : {}),
    fetch: transport,
    ...(o.now ? { now: o.now } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.webhookTrustAnchors?.length ? { webhookTrustAnchors: o.webhookTrustAnchors } : {}),
    // simulator mode only (`webhookSimulator` is never set on a sandbox rail): the simulator's cert URL and CA
    ...(webhookSimulator ? { webhookSimulator } : {}),
    ...(o.webhookTransmissionStore ? { webhookTransmissionStore: o.webhookTransmissionStore } : {}),
  });

  const label: RailLabel = mode === "simulator" ? "simulated" : "sandbox";
  const provenance: Exclude<RailProvenance, "replay"> = mode === "simulator" ? "simulated_rail" : "live";
  return {
    mode,
    label,
    provenance,
    baseUrl: PAYPAL_API_BASE_URL.sandbox,
    fetch: transport,
    simulator,
    core,
    webhookId: o.paypal.webhookId ?? null,
    pages,
    describe: () => ({
      mode,
      label,
      provenance,
      simulator,
      credentials: placeholder ? "placeholder" : "configured",
      webhookId: o.paypal.webhookId ? "configured" : "missing",
    }),
  };
}

const SANDBOX_HOSTS = new Set<string>(PAYPAL_API_HOSTS.sandbox);

/**
 * Sends requests for PayPal's sandbox hosts to `simulate`; everything else goes to the network. The host is compared
 * as DNS does (the URL parser lower-cases it; a fully qualified name's trailing dot is dropped here), so
 * `https://api-m.sandbox.paypal.com./…` cannot slip past the simulator to the real sandbox.
 */
export function routeToSimulator(
  network: FetchLike,
  simulate: (req: Request) => Promise<Response>,
): FetchLike {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const host = url.hostname.replace(/\.+$/, "");
    if (url.protocol === "https:" && SANDBOX_HOSTS.has(host)) {
      url.hostname = host;
      return simulate(new Request(url, init));
    }
    return network(input, init);
  };
}

/** Answers requests under the simulator's pages base URL (`{origin}/paypal-sim/…`) from `pages`, in process. */
function routeToPages(network: FetchLike, pages: SimulatorPages): FetchLike {
  const prefix = `${pages.baseUrl.replace(/\/+$/, "")}/`;
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith(prefix)) return pages.fetch(new Request(url, init));
    return network(input, init);
  };
}

/**
 * STUB (labelled): stands in for packages/paypal-sim until WS-PPSIM lands it. Answers every PayPal call
 * with PayPal's documented error shape, a 503 and a `sim-stub-` debug id, so callers exercise their
 * "PayPal unavailable" path and nothing pretends a payment happened.
 */
export function stubResponse(req: Request): Response {
  const debugId = `sim-stub-${Math.random().toString(16).slice(2, 14)}`;
  const body = {
    name: "SIMULATOR_NOT_RUNNING",
    message:
      "Simulated PayPal sandbox is not running (PP_MODE=simulator). Start tools/paypal-sim.ts and set PP_SIM_URL, or set PP_MODE=sandbox with credentials.",
    debug_id: debugId,
    details: [{ issue: "SIMULATOR_NOT_RUNNING", description: `${req.method} ${new URL(req.url).pathname}` }],
    links: [],
  };
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: { "content-type": "application/json", "paypal-debug-id": debugId, "x-fs-rail": "simulated" },
  });
}

function requestInit(req: Request): RequestInit {
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: req.headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }
  return init;
}
