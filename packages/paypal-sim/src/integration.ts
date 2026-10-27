// The hook paypal-core (or apps/api) calls at boot: in PP_MODE=simulator it creates the simulator and
// routes the sandbox hosts to it in-process; in PP_MODE=sandbox it does nothing.
import { optionsFromEnv, type PayPalMode, resolvePayPalMode, type SimulatorOptions } from "./config.js";
import { type InstalledInterceptor, installSandboxInterceptor } from "./interceptor.js";
import { createSimulator, type Simulator } from "./simulator.js";

/** Invariant I8's provenance for every PayPal-derived value: `simulated_rail` here, `live` on the real sandbox. */
export type RailProvenance = "simulated_rail" | "live";

/** ADR-0002's wording for everything that comes from the simulator (UI, Proof, README, film). */
export const SIMULATED_RAIL_LABEL =
  "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)";

/** PayPal's sandbox API host, as PayPal writes it into webhook event links; the interceptor answers it. */
export const PAYPAL_SANDBOX_API = "https://api.sandbox.paypal.com";

export interface PayPalRail {
  mode: PayPalMode;
  /**
   * Stamp this on every row that holds a PayPal-derived value (I8), from the rail, never from response
   * headers: `x-fairsplit-simulated` and `debug_id` are lost once a body is parsed into the database.
   */
  provenance: RailProvenance;
  /** The label to show next to simulated values; null in sandbox mode. */
  label: string | null;
  /** The simulator (simulator mode only). Never mount `simulator.fetch` publicly. */
  simulator: Simulator | null;
  /**
   * Mount this, and only this, publicly under basePath: the webhook certificate chain, the labelled invoice
   * and pay pages, and /sim/health. No REST API, no admin. Null in sandbox mode.
   */
  publicFetch: ((request: Request) => Promise<Response>) | null;
  interceptor: InstalledInterceptor | null;
  /** Allow-list for `paypal-cert-url` while in simulator mode; null in sandbox mode. */
  certUrlPattern: RegExp | null;
  stop(): Promise<void>;
}

/**
 * `const rail = await setupPayPalRail(process.env, { publicBaseUrl: PUBLIC_BASE_URL, basePath: "/paypal-sim" })`
 * — publicBaseUrl is the host app's own base URL, without the prefix. Simulator mode is the default until
 * sandbox credentials exist (ADR-0002); PP_MODE=sandbox switches back. A PP_CLIENT_ID that belongs to the
 * other mode fails fast here instead of failing every call later with 401 invalid_client.
 */
export async function setupPayPalRail(
  env: NodeJS.ProcessEnv = process.env,
  overrides: SimulatorOptions = {},
): Promise<PayPalRail> {
  const mode = resolvePayPalMode(env);
  const clientId = env.PP_CLIENT_ID?.trim() ?? "";
  if (mode === "sandbox") {
    if (clientId.startsWith("SIM-"))
      throw new Error(
        "PP_MODE=sandbox, but PP_CLIENT_ID is a simulator client id (SIM-…). Use the sandbox REST app's " +
          "client id from developer.paypal.com, or set PP_MODE=simulator.",
      );
    return {
      mode,
      provenance: "live",
      label: null,
      simulator: null,
      publicFetch: null,
      interceptor: null,
      certUrlPattern: null,
      stop: async () => {},
    };
  }
  const simulator = await createSimulator({
    apiBaseUrl: PAYPAL_SANDBOX_API,
    ...optionsFromEnv(env),
    ...overrides,
  });
  if (clientId !== "" && !simulator.appByClientId(clientId)) {
    await simulator.close();
    throw new Error(
      "PP_MODE is simulator (the default), but PP_CLIENT_ID is not one of the simulator's REST apps " +
        "(packages/paypal-sim/data/accounts.json). Set PP_MODE=sandbox to use real sandbox credentials.",
    );
  }
  const interceptor = await installSandboxInterceptor(simulator);
  return {
    mode,
    provenance: "simulated_rail",
    label: SIMULATED_RAIL_LABEL,
    simulator,
    publicFetch: simulator.publicFetch,
    interceptor,
    certUrlPattern: simulator.certUrlPattern,
    async stop() {
      await interceptor.uninstall();
      await simulator.close();
    },
  };
}
