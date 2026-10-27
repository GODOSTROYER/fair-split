// @fairsplit/paypal-sim: a contract-faithful SIMULATOR of the PayPal REST subset Fair Split uses (ADR-0002).
// Everything it produces is labelled: `x-fairsplit-simulated: true` on every response and webhook delivery,
// `debug_id`s in its own `sim-…` format, and a `SIM` marker inside every resource ID it mints. The
// authoritative provenance is PayPalRail.provenance (`simulated_rail`).
export {
  type IdempotencyMode,
  optionsFromEnv,
  type PayPalMode,
  type RateLimitOptions,
  resolvePayPalMode,
  type SimulatorOptions,
} from "./config.js";
export { SANDBOX_HOSTS, SCOPES, SIMULATED_HEADER } from "./constants.js";
export { Contract, defaultSpecDir, SPEC_FILES, type ValidationIssue } from "./contract/openapi.js";
export { CANCEL_TEST_VALUES, CREATE_TEST_VALUES } from "./domain/payouts.js";
export { EVENT_TYPES, MOCK_WEBHOOK_ID, RETRY_BACKOFF_S } from "./domain/webhooks.js";
export type { SimEnv } from "./http/app.js";
export {
  PAYPAL_SANDBOX_API,
  type PayPalRail,
  type RailProvenance,
  SIMULATED_RAIL_LABEL,
  setupPayPalRail,
} from "./integration.js";
export {
  createSandboxDispatcher,
  type DispatcherLike,
  type InstalledInterceptor,
  installSandboxInterceptor,
} from "./interceptor.js";
export { checkWebhookTarget, type WebhookTargetPolicy } from "./net.js";
export { type StartedServer, startServer } from "./server.js";
export { createSimulator, getContract, PUBLISHED_US_INVOICE_FEE, Simulator } from "./simulator.js";
export { loadRegistry, type Registry } from "./state.js";
export { isSimulatedId, SIM_ID_MARKER } from "./util/ids.js";
