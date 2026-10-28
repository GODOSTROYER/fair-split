// fs-api configuration, parsed once at boot with zod (S3.13). Boot refuses, naming the variables and never
// their values, when:
//   - PP_ENV (or the scaffold's PAYPAL_ENV) is anything but `sandbox`, or is missing in production;
//   - PP_DEV_MOCKS is on while RENDER=true (or NODE_ENV=production);
//   - PP_MODE=sandbox lacks PP_CLIENT_ID, PP_CLIENT_SECRET or PP_WEBHOOK_ID;
//   - production lacks FS_COOKIE_SECRET or FS_LINK_SIGNING_KEY, or a value is malformed;
//   - EXECUTOR=workflow lacks RENDER_API_KEY.
//   - a PP_* e-mail setting (PP_BUSINESS_EMAIL, PP_PAYER_EMAIL, PP_UNCLAIMED_RECEIVER, each PP_RECEIVERS entry)
//     is not a strict printable-ASCII address, or PP_CERT_ALLOW names something that is not a PayPal cert id;
//   - FS_TRUSTED_EDGE names no known hop.
// The database role check (a ledger-writable role is refused) needs a connection, so it runs in server.ts.
import { requireAsciiEmail } from "@fairsplit/domain";
import { CERT_ID_PATTERN, checkCertUrl, PAYPAL_API_HOSTS } from "@fairsplit/paypal-core";
import { z } from "zod";

export type PayPalMode = "simulator" | "sandbox";

/**
 * FS_TRUSTED_EDGE: the one hop in front of fs-api whose word on the client's address is believed (S3.9;
 * src/lib/client-ip.ts has the rule for each). `none` off Render and `render` on it by default.
 */
export const TRUSTED_EDGES = ["none", "proxy", "cloudflare", "render"] as const;
export type TrustedEdge = (typeof TRUSTED_EDGES)[number];

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
  /** Which proxy in front of fs-api reports the client's address (none | proxy | cloudflare | render). */
  FS_TRUSTED_EDGE: nonEmpty,

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
  /** PayPal webhook cert ids (or their sandbox cert URLs) to pin, e.g. the current and the next one. */
  PP_CERT_ALLOW: nonEmpty,
  PAYPAL_CERT_ALLOW: nonEmpty,

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
  /** The hop whose report of the client's address per-IP throttles believe (src/lib/client-ip.ts). */
  trustedEdge: TrustedEdge;
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
    /** PP_CERT_ALLOW: the PayPal cert ids the webhook verifier pins (paypal-core `knownCertIds`). */
    knownCertIds: readonly string[];
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
  const knownCertIds = parseCertAllow(r.PP_CERT_ALLOW ?? r.PAYPAL_CERT_ALLOW);
  if (knownCertIds === null) {
    problems.push(
      `PP_CERT_ALLOW must list at most ${MAX_PINNED_CERT_IDS} PayPal cert ids (CERT-xxxxxxxx-xxxxxxxx-xxxxxxxx) or their sandbox cert URLs`,
    );
  }
  problems.push(...emailSettingProblems(r));

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

  // Render is the platform's own word (it sets RENDER=true on every service): there Cloudflare's edge and
  // Render's proxy stand in front of fs-api. Anywhere else nothing is believed until the deployment says so.
  const edgeSetting = r.FS_TRUSTED_EDGE?.toLowerCase();
  const trustedEdge: TrustedEdge = isTrustedEdge(edgeSetting) ? edgeSetting : r.RENDER ? "render" : "none";
  if (edgeSetting !== undefined && !isTrustedEdge(edgeSetting)) {
    problems.push(`FS_TRUSTED_EDGE must be one of ${TRUSTED_EDGES.join(", ")}`);
  } else if (edgeSetting === undefined && production && !r.RENDER) {
    warnings.push(
      "FS_TRUSTED_EDGE unset off Render: per-IP limits key on the socket's peer (set it when a proxy is in front)",
    );
  }

  if (problems.length > 0) throw new BootRefusal(problems);

  return {
    nodeEnv: r.NODE_ENV,
    onRender: r.RENDER,
    production,
    port: r.PORT,
    host: r.HOST,
    publicOrigin: new URL(origin).origin,
    logLevel: r.LOG_LEVEL,
    trustedEdge,
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
      knownCertIds: knownCertIds ?? [],
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

function isTrustedEdge(v: string | undefined): v is TrustedEdge {
  return (TRUSTED_EDGES as readonly string[]).includes(v ?? "");
}

/** The env the kill-switch reads see (`readFlags(db, ws, killEnv(env))`): only the kill variables. */
export function killEnv(env: ApiEnv): Record<string, string | undefined> {
  return { ...env.kill };
}

/** PayPal overlaps at most two signing certificates; a few more leaves room (paypal-core's limit). */
const MAX_PINNED_CERT_IDS = 8;

/** PP_CERT_ALLOW → cert ids (deduplicated, in order), or null when an entry is not one (paypal-core's rule). */
function parseCertAllow(value: string | undefined): string[] | null {
  const ids: string[] = [];
  for (const entry of (value ?? "").split(/[\s,]+/)) {
    if (entry === "") continue;
    let id: string | null = null;
    if (CERT_ID_PATTERN.test(entry)) id = entry;
    else {
      const check = checkCertUrl(entry, PAYPAL_API_HOSTS.sandbox);
      if (check.ok) id = check.certId;
    }
    if (id === null) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length > MAX_PINNED_CERT_IDS ? null : ids;
}

/** A member number as PP_RECEIVERS keys it. */
const RECEIVER_KEY = /^M-\d{3}$/;

/**
 * The PP_* e-mail settings, each a strict printable-ASCII address (domain `requireAsciiEmail`, I1): the policy
 * lattice compares them code unit for code unit, so a lookalike or padded address must stop the boot instead of
 * denying every run later. Problems name the setting (and the member number), never the value.
 */
function emailSettingProblems(r: z.infer<typeof Raw>): string[] {
  const problems: string[] = [];
  const check = (setting: string, value: string | undefined) => {
    if (value === undefined) return;
    try {
      requireAsciiEmail(setting, value);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : `${setting} is not a plain ASCII e-mail address`);
    }
  };
  check(
    r.PP_BUSINESS_EMAIL ? "PP_BUSINESS_EMAIL" : "PAYPAL_BUSINESS_EMAIL",
    r.PP_BUSINESS_EMAIL ?? r.PAYPAL_BUSINESS_EMAIL,
  );
  check(r.PP_PAYER_EMAIL ? "PP_PAYER_EMAIL" : "PAYPAL_BUYER_EMAIL", r.PP_PAYER_EMAIL ?? r.PAYPAL_BUYER_EMAIL);
  check("PP_UNCLAIMED_RECEIVER", r.PP_UNCLAIMED_RECEIVER);
  const name = r.PP_RECEIVERS ? "PP_RECEIVERS" : "PAYPAL_MEMBER_EMAILS";
  const receivers = r.PP_RECEIVERS ?? r.PAYPAL_MEMBER_EMAILS;
  if (receivers === undefined) return problems;
  const entries = receiverEntries(receivers);
  if (entries === null) {
    problems.push(`${name} must be a JSON map or M-001=address pairs of member numbers to e-mail addresses`);
    return problems;
  }
  // Every address must be plain ASCII; an entry not keyed by a member number pays no one (receivers.ts).
  for (const [i, [memberNo, address]] of entries.entries()) {
    check(RECEIVER_KEY.test(memberNo) ? `${name}[${memberNo}]` : `${name} entry ${i + 1}`, address);
  }
  return problems;
}

/**
 * PP_RECEIVERS as `[key, address]` pairs: a JSON map, or comma-separated `M-014=…` pairs (a bare address, the
 * scaffold's PAYPAL_MEMBER_EMAILS list, has an empty key); null when the JSON is unreadable.
 */
function receiverEntries(raw: string): [string, string][] | null {
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as unknown;
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
      return Object.entries(obj).map(([k, v]) => [k, typeof v === "string" ? v.trim() : ""]);
    } catch {
      return null;
    }
  }
  const out: [string, string][] = [];
  for (const pair of text.split(",")) {
    if (pair.trim() === "") continue;
    const at = pair.indexOf("=");
    out.push(at < 0 ? ["", pair.trim()] : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()]);
  }
  return out;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
