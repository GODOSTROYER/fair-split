// The hook paypal-core (or apps/api) calls at boot: in PP_MODE=simulator it creates the simulator and
// routes the sandbox hosts to it in-process; in PP_MODE=sandbox it does nothing.
import { optionsFromEnv, type PayPalMode, resolvePayPalMode, type SimulatorOptions } from "./config.js";
import { type InstalledInterceptor, installSandboxInterceptor } from "./interceptor.js";
import { createSimulator, type Simulator } from "./simulator.js";

export interface PayPalRail {
  mode: PayPalMode;
  /** The simulator (simulator mode only): mount `simulator.fetch` to serve /sim pages publicly. */
  simulator: Simulator | null;
  interceptor: InstalledInterceptor | null;
  /** Allow-list for `paypal-cert-url` while in simulator mode; null in sandbox mode. */
  certUrlPattern: RegExp | null;
  stop(): Promise<void>;
}

/**
 * `const rail = await setupPayPalRail(process.env, { publicBaseUrl, basePath: "/paypal-sim" })`.
 * Simulator mode is the default until sandbox credentials exist (ADR-0002); PP_MODE=sandbox switches back.
 */
export async function setupPayPalRail(
  env: NodeJS.ProcessEnv = process.env,
  overrides: SimulatorOptions = {},
): Promise<PayPalRail> {
  const mode = resolvePayPalMode(env);
  if (mode === "sandbox")
    return { mode, simulator: null, interceptor: null, certUrlPattern: null, stop: async () => {} };
  const simulator = await createSimulator({ ...optionsFromEnv(env), ...overrides });
  const interceptor = await installSandboxInterceptor(simulator);
  return {
    mode,
    simulator,
    interceptor,
    certUrlPattern: simulator.certUrlPattern,
    async stop() {
      await interceptor.uninstall();
      await simulator.close();
    },
  };
}
