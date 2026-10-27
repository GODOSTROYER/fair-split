// fs-api configuration, parsed once at boot with zod (S3.13). Boot refuses, naming the variables and never
// their values, when:
//   - PP_ENV (or the scaffold's PAYPAL_ENV) is anything but `sandbox`, or is missing in production;
//   - PP_DEV_MOCKS is on while RENDER=true (or NODE_ENV=production);
//   - PP_MODE=sandbox lacks PP_CLIENT_ID, PP_CLIENT_SECRET or PP_WEBHOOK_ID;
//   - production lacks FS_COOKIE_SECRET or FS_LINK_SIGNING_KEY, or a value is malformed;
//   - EXECUTOR=workflow lacks RENDER_API_KEY.
// The database role check (a ledger-writable role is refused) needs a connection, so it runs in server.ts.
import { z } from "zod";

export type PayPalMode = "simulator" | "sandbox";

export class BootRefusal extends Error {
  override readonly name = "BootRefusal";
  constructor(readonly problems: readonly string[]) {
    super(`fs-api refuses to boot:\n  - ${problems.join("\n  - ")}`);
  }
}

const TRUE = new Set(["1", "true", "yes", "on"]);
const flag = z
  .string()
  .optional()
  .transform((v) => TRUE.has((v ?? "").trim().toLowerCase()));

const nonEmpty = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const HEX64 = /^[0-9a-f]{64}$/;

const Raw = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RENDER: flag,
  PORT: z.coerce.number().int().min(0).max(65_535).default(8787),
  HOST: z.string().default("0.0.0.0"),
  /** The public origin (links, pairing URLs, CORS-free same-origin checks), e.g. https://fs-api.onrender.com */
  PUBLIC_ORIGIN: nonEmpty,
  PUBLIC_BASE_URL: nonEmpty,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: nonEmpty,
  /** A direct (non-pooled) URL for the LISTEN connection; defaults to DATABASE_URL. */
  LISTEN_DATABASE_URL: nonEmpty,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Accept the S6 fallback where the app connects as the database owner (only triggers guard history). */
  FS_ALLOW_OWNER_ROLE: flag,

  PP_ENV: nonEmpty,
  PAYPAL_ENV: nonEmpty,
  PP_MODE: z.enum(["simulator", "sandbox"]).default("simulator"),
  PP_CLIENT_ID: nonEmpty,
  PAYPAL_CLIENT_ID: nonEmpty,
  PP_CLIENT_SECRET: nonEmpty,
  PAYPAL_CLIENT_SECRET: nonEmpty,
  PP_WEBHOOK_ID: nonEmpty,
  PAYPAL_WEBHOOK_ID: nonEmpty,
  PP_BUSINESS_EMAIL: nonEmpty,
  PAYPAL_BUSINESS_EMAIL: nonEmpty,
  PP_PAYER_EMAIL: nonEmpty,
  PAYPAL_BUYER_EMAIL: nonEmpty,
  PP_RECEIVERS: nonEmpty,
  PAYPAL_MEMBER_EMAILS: nonEmpty,
  PP_UNCLAIMED_RECEIVER: nonEmpty,
  PP_DEV_MOCKS: flag,
  /** Simulator mode: base URL of a running paypal-sim (`tools/paypal-sim.ts`); unset uses the labelled stub. */
  PP_SIM_URL: nonEmpty,

  EXECUTOR: z.enum(["inline", "workflow", "worker"]).default("inline"),
  RENDER_API_KEY: nonEmpty,
  FS_TASKS_SLUG: nonEmpty,
  FS_KILL: nonEmpty,
  KILL_PAYOUTS: nonEmpty,
  KILL_PAYPAL_LIVE: nonEmpty,
  KILL_AI_LIVE: nonEmpty,

  FS_COOKIE_SECRET: nonEmpty,
  FS_LINK_SIGNING_KEY: nonEmpty,
  FS_LEDGER_SIGNING_KEY: nonEmpty,
  FS_OPERATOR_PASSWORD_SCRYPT: nonEmpty,
  CRON_SECRET: nonEmpty,
  JUDGE_CODE_SHA256: nonEmpty,
  ANTHROPIC_API_KEY: nonEmpty,

  FS_REPO_ROOT: nonEmpty,
  STATIC_CONSOLE_DIR: nonEmpty,
  STATIC_APP_DIR: nonEmpty,
  STATIC_MEDIA_DIR: nonEmpty,
});

export interface ApiEnv {
  nodeEnv: "development" | "test" | "production";
  onRender: boolean;
  production: boolean;
  port: number;
  host: string;
  publicOrigin: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  database: {
    url: string | undefined;
    listenUrl: string | undefined;
    poolMax: number;
    allowOwnerRole: boolean;
  };
  paypal: {
    env: "sandbox";
    mode: PayPalMode;
    clientId: string | undefined;
    clientSecret: string | undefined;
    webhookId: string | undefined;
    businessEmail: string | undefined;
    payerEmail: string | undefined;
    receivers: string | undefined;
    unclaimedReceiver: string | undefined;
    devMocks: boolean;
    simUrl: string | undefined;
  };
  executor: { kind: "inline" | "workflow" | "worker"; renderApiKey: string | undefined; tasksSlug: string };
  /** FS_KILL and the scaffold's KILL_* booleans, handed to `@fairsplit/db` flag reads (never cached). */
  kill: Readonly<
    Record<"FS_KILL" | "KILL_PAYOUTS" | "KILL_PAYPAL_LIVE" | "KILL_AI_LIVE", string | undefined>
  >;
  secrets: {
    /** ≥ 32 characters; every HMAC subkey (cookies, IP hashing) derives from it. */
    cookieSecret: string | undefined;
    /** Ed25519 seed, 64 hex: signs member and brand links. */
    linkSigningKey: string | undefined;
    /** Ed25519 seed, 64 hex: signs ledger checkpoints (Proof slice); absent → ephemeral `seeded` key. */
    ledgerSigningKey: string | undefined;
    operatorPasswordScrypt: string | undefined;
    cronSecret: string | undefined;
    judgeCodeSha256: string | undefined;
    anthropicApiKey: string | undefined;
  };
  static: {
    repoRoot: string | undefined;
    consoleDir: string | undefined;
    appDir: string | undefined;
    mediaDir: string | undefined;
  };
  /** Warnings worth one log line at boot (ephemeral keys, defaulted PP_ENV). Never values. */
  warnings: string[];
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Parse and check the environment. Throws BootRefusal listing every problem at once. */
export function parseEnv(source: EnvSource = process.env): ApiEnv {
  const parsed = Raw.safeParse(source);
  if (!parsed.success) {
    throw new BootRefusal(
      parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message} (value not shown)`),
    );
  }
  const r = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];
  const production = r.NODE_ENV === "production" || r.RENDER;

  const ppEnv = r.PP_ENV ?? r.PAYPAL_ENV;
  if (ppEnv !== undefined && ppEnv !== "sandbox") {
    problems.push("PP_ENV must be sandbox: Fair Split never talks to live PayPal");
  } else if (ppEnv === undefined) {
    if (production) problems.push("PP_ENV is missing (set PP_ENV=sandbox)");
    else warnings.push("PP_ENV unset; assuming sandbox outside production");
  }

  if (r.PP_DEV_MOCKS && production) {
    problems.push(
      "PP_DEV_MOCKS cannot be on in production or on Render (simulated events would be accepted)",
    );
  }

  const clientId = r.PP_CLIENT_ID ?? r.PAYPAL_CLIENT_ID;
  const clientSecret = r.PP_CLIENT_SECRET ?? r.PAYPAL_CLIENT_SECRET;
  const webhookId = r.PP_WEBHOOK_ID ?? r.PAYPAL_WEBHOOK_ID;
  if (r.PP_MODE === "sandbox") {
    const missing = [
      ...(clientId ? [] : ["PP_CLIENT_ID"]),
      ...(clientSecret ? [] : ["PP_CLIENT_SECRET"]),
      ...(webhookId ? [] : ["PP_WEBHOOK_ID"]),
    ];
    if (missing.length > 0) problems.push(`PP_MODE=sandbox needs ${missing.join(", ")}`);
  }
  if (r.PP_SIM_URL !== undefined && !isHttpUrl(r.PP_SIM_URL))
    problems.push("PP_SIM_URL must be an http(s) URL");

  if (r.FS_COOKIE_SECRET !== undefined && r.FS_COOKIE_SECRET.length < 32) {
    problems.push("FS_COOKIE_SECRET must be at least 32 characters");
  }
  for (const name of ["FS_LINK_SIGNING_KEY", "FS_LEDGER_SIGNING_KEY"] as const) {
    const v = r[name];
    if (v !== undefined && !HEX64.test(v))
      problems.push(`${name} must be a 32-byte Ed25519 seed in lowercase hex`);
  }
  if (r.JUDGE_CODE_SHA256 !== undefined && !HEX64.test(r.JUDGE_CODE_SHA256)) {
    problems.push("JUDGE_CODE_SHA256 must be a lowercase hex sha256");
  }
  if (production) {
    if (!r.FS_COOKIE_SECRET) problems.push("FS_COOKIE_SECRET is required in production");
    if (!r.FS_LINK_SIGNING_KEY) problems.push("FS_LINK_SIGNING_KEY is required in production");
    if (!r.DATABASE_URL) problems.push("DATABASE_URL is required in production");
  } else {
    if (!r.FS_COOKIE_SECRET)
      warnings.push("FS_COOKIE_SECRET unset: using an ephemeral key (sessions end on restart)");
    if (!r.FS_LINK_SIGNING_KEY)
      warnings.push("FS_LINK_SIGNING_KEY unset: using an ephemeral key (links end on restart)");
  }
  if (!r.FS_LEDGER_SIGNING_KEY)
    warnings.push(
      "FS_LEDGER_SIGNING_KEY unset: ledger checkpoints use an ephemeral seeded key (Proof reads Sample)",
    );
  if (r.EXECUTOR === "workflow" && !r.RENDER_API_KEY) problems.push("EXECUTOR=workflow needs RENDER_API_KEY");
  if (r.FS_ALLOW_OWNER_ROLE && production) {
    warnings.push("FS_ALLOW_OWNER_ROLE is on: only triggers guard history (record the S6 ADR)");
  }

  const origin = r.PUBLIC_ORIGIN ?? r.PUBLIC_BASE_URL ?? `http://localhost:${r.PORT}`;
  if (!isHttpUrl(origin)) problems.push("PUBLIC_ORIGIN must be an http(s) origin");

  if (problems.length > 0) throw new BootRefusal(problems);

  return {
    nodeEnv: r.NODE_ENV,
    onRender: r.RENDER,
    production,
    port: r.PORT,
    host: r.HOST,
    publicOrigin: new URL(origin).origin,
    logLevel: r.LOG_LEVEL,
    database: {
      url: r.DATABASE_URL,
      listenUrl: r.LISTEN_DATABASE_URL ?? r.DATABASE_URL,
      poolMax: r.DB_POOL_MAX,
      allowOwnerRole: r.FS_ALLOW_OWNER_ROLE,
    },
    paypal: {
      env: "sandbox",
      mode: r.PP_MODE,
      clientId,
      clientSecret,
      webhookId,
      businessEmail: r.PP_BUSINESS_EMAIL ?? r.PAYPAL_BUSINESS_EMAIL,
      payerEmail: r.PP_PAYER_EMAIL ?? r.PAYPAL_BUYER_EMAIL,
      receivers: r.PP_RECEIVERS ?? r.PAYPAL_MEMBER_EMAILS,
      unclaimedReceiver: r.PP_UNCLAIMED_RECEIVER,
      devMocks: r.PP_DEV_MOCKS,
      simUrl: r.PP_SIM_URL,
    },
    executor: { kind: r.EXECUTOR, renderApiKey: r.RENDER_API_KEY, tasksSlug: r.FS_TASKS_SLUG ?? "fs-tasks" },
    kill: {
      FS_KILL: r.FS_KILL,
      KILL_PAYOUTS: r.KILL_PAYOUTS,
      KILL_PAYPAL_LIVE: r.KILL_PAYPAL_LIVE,
      KILL_AI_LIVE: r.KILL_AI_LIVE,
    },
    secrets: {
      cookieSecret: r.FS_COOKIE_SECRET,
      linkSigningKey: r.FS_LINK_SIGNING_KEY,
      ledgerSigningKey: r.FS_LEDGER_SIGNING_KEY,
      operatorPasswordScrypt: r.FS_OPERATOR_PASSWORD_SCRYPT,
      cronSecret: r.CRON_SECRET,
      judgeCodeSha256: r.JUDGE_CODE_SHA256,
      anthropicApiKey: r.ANTHROPIC_API_KEY,
    },
    static: {
      repoRoot: r.FS_REPO_ROOT,
      consoleDir: r.STATIC_CONSOLE_DIR,
      appDir: r.STATIC_APP_DIR,
      mediaDir: r.STATIC_MEDIA_DIR,
    },
    warnings,
  };
}

/** The env the kill-switch reads see (`readFlags(db, ws, killEnv(env))`): only the kill variables. */
export function killEnv(env: ApiEnv): Record<string, string | undefined> {
  return { ...env.kill };
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
