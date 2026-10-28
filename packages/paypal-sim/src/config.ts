// Simulator options and their environment-variable spellings.
import type { Registry } from "./state.js";

export interface RateLimitOptions {
  /** Requests allowed per rolling minute per client address (the sandbox blocks above 50 per IP). */
  perMinute: number;
  /** How long an address stays blocked after exceeding the limit. */
  blockSeconds: number;
  /** Most addresses tracked at once (default 10,000); the stalest are dropped first. */
  maxKeys?: number;
}

/** Which POSTs honour `PayPal-Request-Id` (see SimulatorOptions.idempotency). */
export type IdempotencyMode = "declared" | "all-posts";

export interface SimulatorOptions {
  /**
   * The public base URL of whatever serves the simulator's pages (the host app, or the standalone server),
   * WITHOUT `basePath`: pages live at `{publicBaseUrl}{basePath}/sim/...`. A publicBaseUrl that already ends
   * in basePath is refused, because it would put the prefix into every cert and pay-page URL twice.
   */
  publicBaseUrl?: string;
  /**
   * Where the simulated REST API is reached, for the links inside webhook events. Default
   * `{publicBaseUrl}{basePath}`; setupPayPalRail() uses PayPal's own `https://api.sandbox.paypal.com`,
   * which the in-process interceptor answers.
   */
  apiBaseUrl?: string;
  /** The path prefix the host app mounts the simulator under (stripped before routing), e.g. "/paypal-sim". */
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
  /**
   * Also record, as contract violations, response and event properties the vendored spec never declares
   * (PayPal's schemas accept invented fields, since they rarely say `additionalProperties: false`). Off by
   * default; the test suite turns it on.
   */
  strictProperties?: boolean;
  now?: () => number;
  /** Used to POST webhook deliveries (default: global fetch). It is always called with `redirect: "manual"`. */
  deliveryFetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** `maxAttempts` counts the first delivery too: the default 26 is PayPal's first try plus 25 retries. */
  delivery?: { outOfOrder?: boolean; duplicate?: boolean; maxAttempts?: number; timeoutMs?: number };
  timing?: { batchProcessingS?: number; itemS?: number; batchCompleteS?: number };
  /** Payout fee per item in cents (register §2: the published US rate, US$0.25 per item). */
  payoutFeeCents?: number;
  /**
   * Receiving fee on invoices paid on the simulator's pay page. Default: PayPal's published US rate for an
   * invoice paid with PayPal, 3.49% + US$0.49 (349 bps + 49 cents); `{ percentBps: 0, fixedCents: 0 }` turns
   * it off. Recorded payments (MARKED_AS_PAID) move no money, so they never carry a fee.
   */
  invoiceFee?: { percentBps: number; fixedCents: number };
  /** Transaction Search reporting lag in seconds (default 0). */
  reportingLagSeconds?: number;
  /** Days before an UNCLAIMED item is returned automatically (default 30). */
  unclaimedReturnDays?: number;
  logger?: (message: string) => void;
  /**
   * When set, /sim/admin/* requires the header `x-sim-admin-token` from every caller (compared in constant
   * time). Without it the admin API fails closed: it answers only a caller whose socket address is known and
   * loopback (or code in this process), and only while the simulator is local (see `standalone`). publicFetch
   * never serves it, and no webhook delivery ever reaches it.
   */
  adminToken?: string;
  /**
   * Extra origins (`https://host[:port]`) webhooks may be delivered to. The origin of publicBaseUrl (the host
   * app, whose `/webhooks/paypal` receives them) is allowed too, except when the simulator serves that origin
   * itself (`standalone`). The simulator's own /sim pages, and any server it answers in full, never are.
   */
  webhookOrigins?: string[];
  /**
   * Dev only: also deliver webhooks to loopback hosts on any port (never the simulator's own). Refused unless
   * publicBaseUrl is loopback and, for the standalone server, it binds a loopback address.
   */
  allowLoopbackWebhooks?: boolean;
  /**
   * Set by startServer(): this simulator answers HTTP itself, bound to `host` and reached at `url`. That
   * address and publicBaseUrl then lead to the simulator, so neither is ever a webhook target; and bound to a
   * non-loopback host, the admin API needs `adminToken`.
   */
  standalone?: { url: string; host: string };
  /** Behind one trusted proxy: key the throttle on the right-most X-Forwarded-For entry (default: the socket). */
  trustProxy?: boolean;
  /**
   * `declared` (default): replay `PayPal-Request-Id` only on operations whose vendored spec declares that
   * header (Payouts `POST /v1/payments/payouts`); elsewhere the header is ignored, because PayPal's reference
   * says not every API supports it. `all-posts`: replay on every bearer POST (the earlier, lenient behaviour).
   */
  idempotency?: IdempotencyMode;
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
 * SIM_STRICT, SIM_STRICT_PROPERTIES, SIM_OUT_OF_ORDER, SIM_DUPLICATE_DELIVERY, SIM_PAYOUT_FEE_CENTS, SIM_REPORTING_LAG_S,
 * SIM_ACCOUNTS_FILE, SIM_ADMIN_TOKEN, SIM_WEBHOOK_ORIGINS (comma-separated), SIM_ALLOW_LOOPBACK_WEBHOOKS,
 * SIM_TRUST_PROXY, SIM_IDEMPOTENCY (declared | all-posts), SIM_INVOICE_FEE_BPS, SIM_INVOICE_FEE_CENTS.
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
  const strictProperties = bool(env.SIM_STRICT_PROPERTIES);
  if (strictProperties !== undefined) opts.strictProperties = strictProperties;
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
  if (env.SIM_WEBHOOK_ORIGINS)
    opts.webhookOrigins = env.SIM_WEBHOOK_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter((o) => o !== "");
  const loopback = bool(env.SIM_ALLOW_LOOPBACK_WEBHOOKS);
  if (loopback !== undefined) opts.allowLoopbackWebhooks = loopback;
  const trustProxy = bool(env.SIM_TRUST_PROXY);
  if (trustProxy !== undefined) opts.trustProxy = trustProxy;
  const idempotency = env.SIM_IDEMPOTENCY?.trim().toLowerCase();
  if (idempotency === "declared" || idempotency === "all-posts") opts.idempotency = idempotency;
  else if (idempotency)
    throw new Error(`SIM_IDEMPOTENCY must be "declared" or "all-posts" (got "${env.SIM_IDEMPOTENCY}")`);
  const feeBps = num(env.SIM_INVOICE_FEE_BPS);
  const feeCents = num(env.SIM_INVOICE_FEE_CENTS);
  if (feeBps !== undefined || feeCents !== undefined)
    opts.invoiceFee = { percentBps: feeBps ?? 0, fixedCents: feeCents ?? 0 };
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
