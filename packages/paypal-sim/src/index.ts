// @fairsplit/paypal-sim: a contract-faithful SIMULATOR of the PayPal REST subset Fair Split uses (ADR-0002).
// Everything it produces is labelled: `x-fairsplit-simulated: true` on every response and webhook delivery,
// and `debug_id`s in its own `sim-…` format.
export { optionsFromEnv, type PayPalMode, resolvePayPalMode, type SimulatorOptions } from "./config.js";
export { SANDBOX_HOSTS, SCOPES, SIMULATED_HEADER } from "./constants.js";
export { Contract, defaultSpecDir, SPEC_FILES, type ValidationIssue } from "./contract/openapi.js";
export { CANCEL_TEST_VALUES, CREATE_TEST_VALUES } from "./domain/payouts.js";
export { EVENT_TYPES, MOCK_WEBHOOK_ID } from "./domain/webhooks.js";
export { type PayPalRail, setupPayPalRail } from "./integration.js";
export {
  createSandboxDispatcher,
  type DispatcherLike,
  type InstalledInterceptor,
  installSandboxInterceptor,
} from "./interceptor.js";
export { type StartedServer, startServer } from "./server.js";
export { createSimulator, getContract, Simulator } from "./simulator.js";
export { loadRegistry, type Registry } from "./state.js";
