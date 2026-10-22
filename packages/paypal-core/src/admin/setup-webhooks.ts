// The logic behind tools/setup-webhooks.ts (S5.4 step 6, S3.6.5 "Registration"). Kept here so it
// is typed and tested with the package; the tool is a thin entry point.
//
//   corepack pnpm tsx tools/setup-webhooks.ts --app fs-dev --url https://<tunnel>/webhooks/paypal
//
// Prints only non-secret ids (webhook id, lookup id, URL, scope names). Never prints the client id,
// secret or token. Idempotent: a re-run with the same URL reports "unchanged".

import { parseArgs } from "node:util";
import { createPayPalAuth } from "../auth.js";
import { loadPayPalConfig } from "../config.js";
import { PayPalAuthError, PayPalConfigError, PayPalHttpError } from "../errors.js";
import { createPayPalHttp } from "../http.js";
import { createMemoryLimiter } from "../limiter.js";
import type { FetchLike } from "../types.js";
import { ensureWebhook, ensureWebhookLookup } from "./webhooks.js";

export const SETUP_WEBHOOKS_USAGE = [
  "Usage: corepack pnpm tsx tools/setup-webhooks.ts --app <fs-dev|fs-judge> --url https://<host>/webhooks/paypal",
  "         [--dry-run] [--no-lookup] [--force]",
  "Registers the register's 15 webhook event types on the REST app whose PP_CLIENT_ID / PP_CLIENT_SECRET",
  "(or PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are in the environment. Sandbox only.",
].join("\n");

export interface SetupWebhooksIo {
  out(line: string): void;
  err(line: string): void;
}

export interface SetupWebhooksDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const APPS = new Set(["fs-dev", "fs-judge"]);

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
  env: Readonly<Record<string, string | undefined>>,
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
  const app = values.app ?? "";
  const target = values.url ?? "";
  if (!APPS.has(app)) {
    io.err("--app must be fs-dev or fs-judge");
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
    (app === "fs-judge" && host.endsWith(".trycloudflare.com")) ||
    (app === "fs-dev" && host.endsWith(".onrender.com"));
  if (mismatch && !values.force) {
    io.err(
      `refusing: --app ${app} with ${host} looks like the wrong app (moving its webhook would break it).`,
    );
    io.err("Re-run with --force if this is intended.");
    return 2;
  }

  const dryRun = values["dry-run"] === true;
  try {
    const config = loadPayPalConfig(env, { requireWebhookId: false });
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

    io.out(`setup-webhooks: app=${app} env=${config.env}${dryRun ? " (dry run)" : ""}`);
    const scopes = await auth.capabilities();
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
