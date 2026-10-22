// The logic behind tools/setup-webhooks.ts (S5.4 step 6, S3.6.5 "Registration"). Kept here so it
// is typed and tested with the package; the tool is a thin entry point.
//
//   corepack pnpm tsx tools/setup-webhooks.ts --app dev --url https://<tunnel>/webhooks/paypal
//
// `--app` picks the REST app (dev|judge, or fs-dev|fs-judge) and with it the credentials:
//   PP_CLIENT_ID_<APP> / PP_CLIENT_SECRET_<APP> (APP = DEV or JUDGE), else the shared PP_CLIENT_ID /
//   PP_CLIENT_SECRET. After the token arrives, its app_id is checked: it must equal PP_APP_ID_<APP>
//   when that is set, and must not equal the other app's PP_APP_ID_*. Using the shared credentials for
//   judge needs PP_APP_ID_JUDGE (or --force), because the shared pair is the dev app's by convention and
//   would otherwise move dev's webhook. Mismatches are refused even with --force.
//
// Prints only non-secret ids (webhook id, lookup id, app id, URL, scope names, variable names). Never
// prints the client id, secret or token. Idempotent: a re-run with the same URL reports "unchanged".

import { parseArgs } from "node:util";
import { createPayPalAuth } from "../auth.js";
import { loadPayPalConfig } from "../config.js";
import { PayPalAuthError, PayPalConfigError, PayPalHttpError } from "../errors.js";
import { createPayPalHttp } from "../http.js";
import { createMemoryLimiter } from "../limiter.js";
import { checkScopes } from "../scopes.js";
import type { FetchLike } from "../types.js";
import { ensureWebhook, ensureWebhookLookup } from "./webhooks.js";

export const SETUP_WEBHOOKS_USAGE = [
  "Usage: corepack pnpm tsx tools/setup-webhooks.ts --app <dev|judge> --url https://<host>/webhooks/paypal",
  "         [--dry-run] [--no-lookup] [--force]",
  "Registers the register's 15 webhook event types on one sandbox REST app (--app fs-dev|fs-judge also works).",
  "Credentials: PP_CLIENT_ID_<APP> / PP_CLIENT_SECRET_<APP> (APP = DEV or JUDGE), else PP_CLIENT_ID /",
  "PP_CLIENT_SECRET. Set PP_APP_ID_<APP> to the app_id this tool prints so mismatched credentials are",
  "refused; --app judge with the shared PP_CLIENT_ID needs PP_APP_ID_JUDGE or --force. Sandbox only.",
].join("\n");

export interface SetupWebhooksIo {
  out(line: string): void;
  err(line: string): void;
}

export interface SetupWebhooksDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export type WebhookApp = "dev" | "judge";

const APP_ALIASES: Readonly<Record<string, WebhookApp>> = Object.freeze({
  dev: "dev",
  "fs-dev": "dev",
  judge: "judge",
  "fs-judge": "judge",
});

/** `dev`, `judge`, `fs-dev` or `fs-judge` (any case) → the app; anything else → null. */
export function parseWebhookApp(value: string | undefined): WebhookApp | null {
  return APP_ALIASES[(value ?? "").trim().toLowerCase()] ?? null;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

const suffix = (app: WebhookApp) => (app === "dev" ? "DEV" : "JUDGE");
const otherApp = (app: WebhookApp): WebhookApp => (app === "dev" ? "judge" : "dev");
const read = (env: EnvSource, name: string) => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

interface CredentialChoice {
  /** The environment to load the PayPal config from (app-specific credentials mapped onto PP_*). */
  view: EnvSource;
  /** Variable names only, for the log line. */
  source: string;
  shared: boolean;
}

function chooseCredentials(app: WebhookApp, env: EnvSource): CredentialChoice | { error: string } {
  const idName = `PP_CLIENT_ID_${suffix(app)}`;
  const secretName = `PP_CLIENT_SECRET_${suffix(app)}`;
  const id = read(env, idName);
  const secret = read(env, secretName);
  if (id && secret) {
    return {
      view: {
        ...env,
        PP_CLIENT_ID: id,
        PP_CLIENT_SECRET: secret,
        PAYPAL_CLIENT_ID: undefined,
        PAYPAL_CLIENT_SECRET: undefined,
      },
      source: `${idName}/${secretName}`,
      shared: false,
    };
  }
  if (id || secret) return { error: `set both ${idName} and ${secretName}, or neither` };
  return { view: env, source: "PP_CLIENT_ID/PP_CLIENT_SECRET (shared)", shared: true };
}

function checkTargetUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "--url is not a valid URL";
  }
  if (url.protocol !== "https:") return "--url must be https (PayPal delivers webhooks to HTTPS on port 443)";
  if (url.port !== "" || url.username || url.password) return "--url must not carry a port or credentials";
  if (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    return "--url must be a public hostname (use the Cloudflare tunnel URL in dev)";
  }
  if (!url.pathname.endsWith("/webhooks/paypal")) return "--url path must end with /webhooks/paypal";
  if (url.search || url.hash) return "--url must not have a query or fragment";
  return null;
}

export async function runSetupWebhooks(
  argv: readonly string[],
  env: EnvSource,
  io: SetupWebhooksIo,
  deps: SetupWebhooksDeps = {},
): Promise<number> {
  let values: {
    app?: string;
    url?: string;
    "dry-run"?: boolean;
    "no-lookup"?: boolean;
    force?: boolean;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        app: { type: "string" },
        url: { type: "string" },
        "dry-run": { type: "boolean" },
        "no-lookup": { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    io.err(SETUP_WEBHOOKS_USAGE);
    return 2;
  }
  if (values.help) {
    io.out(SETUP_WEBHOOKS_USAGE);
    return 0;
  }
  const app = parseWebhookApp(values.app);
  const target = values.url ?? "";
  const force = values.force === true;
  if (!app) {
    io.err("--app must be dev or judge (fs-dev and fs-judge also work)");
    io.err(SETUP_WEBHOOKS_USAGE);
    return 2;
  }
  const urlProblem = checkTargetUrl(target);
  if (urlProblem) {
    io.err(urlProblem);
    return 2;
  }
  const host = new URL(target).hostname;
  const mismatch =
    (app === "judge" && host.endsWith(".trycloudflare.com")) ||
    (app === "dev" && host.endsWith(".onrender.com"));
  if (mismatch && !force) {
    io.err(
      `refusing: --app ${app} with ${host} looks like the wrong app (moving its webhook would break it).`,
    );
    io.err("Re-run with --force if this is intended.");
    return 2;
  }

  const credentials = chooseCredentials(app, env);
  if ("error" in credentials) {
    io.err(`config: ${credentials.error}`);
    return 2;
  }
  const expectedAppId = read(env, `PP_APP_ID_${suffix(app)}`);
  const otherAppId = read(env, `PP_APP_ID_${suffix(otherApp(app))}`);
  if (credentials.shared && app === "judge" && !expectedAppId && !force) {
    io.err(
      "refusing: --app judge with the shared PP_CLIENT_ID, which is the dev app's by convention. Set " +
        "PP_CLIENT_ID_JUDGE/PP_CLIENT_SECRET_JUDGE, or PP_APP_ID_JUDGE to confirm these are fs-judge's, or pass --force.",
    );
    return 2;
  }

  const dryRun = values["dry-run"] === true;
  try {
    const config = loadPayPalConfig(credentials.view, { requireWebhookId: false });
    const auth = createPayPalAuth({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    const http = createPayPalHttp({
      auth,
      limiter: createMemoryLimiter(),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });

    io.out(`setup-webhooks: app=fs-${app} env=${config.env}${dryRun ? " (dry run)" : ""}`);
    const token = await auth.token();
    io.out(`credentials: ${credentials.source} app_id=${token.appId ?? "(not reported)"}`);

    // Identity: never touch another app's webhook. Not overridable by --force.
    if (expectedAppId && token.appId !== expectedAppId) {
      io.err(
        `refusing: these credentials belong to app_id ${token.appId ?? "(not reported)"}, but PP_APP_ID_${suffix(app)} is ${expectedAppId}.`,
      );
      return 1;
    }
    if (otherAppId && token.appId === otherAppId) {
      io.err(
        `refusing: these credentials are fs-${otherApp(app)}'s (PP_APP_ID_${suffix(otherApp(app))}); ` +
          `pass fs-${app}'s as PP_CLIENT_ID_${suffix(app)}/PP_CLIENT_SECRET_${suffix(app)}.`,
      );
      return 1;
    }

    const scopes = checkScopes(token.scopes);
    io.out(
      `scopes: ${Object.entries(scopes.capabilities)
        .map(([name, state]) => `${name}=${state}`)
        .join(" ")}`,
    );
    if (scopes.capabilities.webhooks !== "granted") {
      io.err("the token lacks the webhooks scope; check the REST app's features");
      return 1;
    }

    const hook = await ensureWebhook(http, { url: target, dryRun });
    io.out(
      `webhook: ${hook.action}${dryRun ? " (planned)" : ""} id=${hook.webhookId ?? "(new)"} url=${hook.url} events=${hook.eventTypes.length}`,
    );
    if (hook.previousUrl) io.out(`webhook: previous url=${hook.previousUrl}`);
    if (hook.staleWebhookIds.length > 0) {
      io.out(`webhook: other webhooks on this path left untouched: ${hook.staleWebhookIds.join(", ")}`);
    }
    if (values["no-lookup"] !== true) {
      const lookup = await ensureWebhookLookup(http, { dryRun });
      io.out(`lookup: ${lookup.action}${dryRun ? " (planned)" : ""} id=${lookup.lookupId ?? "(new)"}`);
    }
    if (hook.webhookId) io.out(`PP_WEBHOOK_ID=${hook.webhookId}`);
    if (!expectedAppId && token.appId) {
      io.out(
        `tip: add PP_APP_ID_${suffix(app)}=${token.appId} to the env so a mismatched app is refused next time`,
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof PayPalConfigError) {
      io.err(`config: ${err.message}`);
    } else if (err instanceof PayPalHttpError) {
      io.err(`PayPal error: ${err.paypalName} (status ${err.status}, debug_id ${err.debugId ?? "none"})`);
    } else if (err instanceof PayPalAuthError) {
      io.err(`OAuth error: ${err.message} (debug_id ${err.debugId ?? "none"})`);
    } else {
      io.err(`failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 1;
  }
}
