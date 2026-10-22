// Simulator options and their environment-variable spellings.
import type { Registry } from "./state.js";

export interface RateLimitOptions {
  /** Requests allowed per rolling minute per client (the sandbox blocks above 50 per IP). */
  perMinute: number;
  /** How long a client stays blocked after exceeding the limit. */
  blockSeconds: number;
}

export interface SimulatorOptions {
  /** Where browsers and webhook verifiers reach the simulator's own pages (/sim/...). */
  publicBaseUrl?: string;
  /** Base URL used for HATEOAS links inside webhook events (defaults to publicBaseUrl). */
  apiBaseUrl?: string;
  /** A path prefix the simulator is mounted under (stripped before routing), e.g. "/paypal-sim". */
  basePath?: string;
  /** Multiplier for processing delays: 1 ≈ real seconds, 0 = next tick (tests). */
  speed?: number;
  /** Directory for signing keys and the optional state snapshot; null keeps everything in memory. */
  dataDir?: string | null;
  /** Write a JSON snapshot of the state to dataDir/state.json after every change. */
  persist?: boolean;
  accountsFile?: string;
  registry?: Registry;
  specDir?: string;
  rateLimit?: RateLimitOptions | false;
  /** Fixed latency or a [min, max] range in milliseconds added to every PayPal API response. */
  latencyMs?: number | [number, number];
  /** A response that violates the vendored spec becomes a 500 (default true). */
  strict?: boolean;
  now?: () => number;
  /** Used to POST webhook deliveries (default: global fetch). */
  deliveryFetch?: (url: string, init: RequestInit) => Promise<Response>;
  delivery?: { outOfOrder?: boolean; duplicate?: boolean; maxAttempts?: number; timeoutMs?: number };
  timing?: { batchProcessingS?: number; itemS?: number; batchCompleteS?: number };
  /** Payout fee per item in cents (register §2: the published US rate, US$0.25 per item). */
  payoutFeeCents?: number;
  /** Optional receiving fee on invoices paid on the simulator's pay page (default 0 = none). */
  invoiceFee?: { percentBps: number; fixedCents: number };
  /** Transaction Search reporting lag in seconds (default 0). */
  reportingLagSeconds?: number;
  /** Days before an UNCLAIMED item is returned automatically (default 30). */
  unclaimedReturnDays?: number;
  logger?: (message: string) => void;
  /** When set, /sim/admin/* requires the header `x-sim-admin-token`. */
  adminToken?: string;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

/**
 * Reads simulator options from the environment:
 * SIM_PUBLIC_URL, SIM_API_BASE_URL, SIM_BASE_PATH, SIM_SPEED, SIM_DATA_DIR, SIM_PERSIST,
 * SIM_RATE_LIMIT_PER_MIN (0 disables), SIM_RATE_LIMIT_BLOCK_S, SIM_LATENCY_MS ("120" or "80-250"),
 * SIM_STRICT, SIM_OUT_OF_ORDER, SIM_DUPLICATE_DELIVERY, SIM_PAYOUT_FEE_CENTS, SIM_REPORTING_LAG_S,
 * SIM_ACCOUNTS_FILE, SIM_ADMIN_TOKEN.
 */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): SimulatorOptions {
  const opts: SimulatorOptions = {};
  if (env.SIM_PUBLIC_URL) opts.publicBaseUrl = env.SIM_PUBLIC_URL;
  if (env.SIM_API_BASE_URL) opts.apiBaseUrl = env.SIM_API_BASE_URL;
  if (env.SIM_BASE_PATH) opts.basePath = env.SIM_BASE_PATH;
  const speed = num(env.SIM_SPEED);
  if (speed !== undefined) opts.speed = speed;
  if (env.SIM_DATA_DIR) opts.dataDir = env.SIM_DATA_DIR;
  const persist = bool(env.SIM_PERSIST);
  if (persist !== undefined) opts.persist = persist;
  const perMinute = num(env.SIM_RATE_LIMIT_PER_MIN);
  const blockSeconds = num(env.SIM_RATE_LIMIT_BLOCK_S);
  if (perMinute === 0) opts.rateLimit = false;
  else if (perMinute !== undefined || blockSeconds !== undefined)
    opts.rateLimit = { perMinute: perMinute ?? 50, blockSeconds: blockSeconds ?? 300 };
  if (env.SIM_LATENCY_MS) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(env.SIM_LATENCY_MS.trim());
    if (m) opts.latencyMs = m[2] ? [Number(m[1]), Number(m[2])] : Number(m[1]);
  }
  const strict = bool(env.SIM_STRICT);
  if (strict !== undefined) opts.strict = strict;
  const outOfOrder = bool(env.SIM_OUT_OF_ORDER);
  const duplicate = bool(env.SIM_DUPLICATE_DELIVERY);
  if (outOfOrder !== undefined || duplicate !== undefined)
    opts.delivery = { outOfOrder: outOfOrder ?? false, duplicate: duplicate ?? false };
  const fee = num(env.SIM_PAYOUT_FEE_CENTS);
  if (fee !== undefined) opts.payoutFeeCents = fee;
  const lag = num(env.SIM_REPORTING_LAG_S);
  if (lag !== undefined) opts.reportingLagSeconds = lag;
  if (env.SIM_ACCOUNTS_FILE) opts.accountsFile = env.SIM_ACCOUNTS_FILE;
  if (env.SIM_ADMIN_TOKEN) opts.adminToken = env.SIM_ADMIN_TOKEN;
  return opts;
}

export type PayPalMode = "simulator" | "sandbox";

/** PP_MODE=simulator (default until sandbox credentials exist, ADR-0002) or PP_MODE=sandbox. */
export function resolvePayPalMode(env: NodeJS.ProcessEnv = process.env): PayPalMode {
  const v = (env.PP_MODE ?? "simulator").trim().toLowerCase();
  if (v === "sandbox") return "sandbox";
  if (v === "simulator" || v === "") return "simulator";
  throw new Error(`PP_MODE must be "simulator" or "sandbox" (got "${env.PP_MODE}")`);
}
