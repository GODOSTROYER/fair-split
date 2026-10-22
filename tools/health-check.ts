// Fair Split health check (S5 December runbook; architecture §10 judgeReset health list).
//
//   corepack pnpm exec tsx tools/health-check.ts [--origin=https://fs-api.onrender.com] [--json]
//
// Checks, each reported as ok / warn / fail / skip:
//   api.healthz      GET {origin}/healthz must be 200 (liveness; Render's health check path)
//   api.readyz       GET {origin}/readyz (readiness: DB, LISTEN, token scope, webhooks, flags, dispatcher)
//   paypal.env       PP_ENV must be "sandbox"; anything else stops the PayPal checks
//   paypal.token     OAuth client-credentials; exact scopes for invoicing, payouts, search and balances
//   paypal.webhook   our registration exists, points at {origin}/webhooks/paypal, has all 15 events (register §8)
//   paypal.balance   USD available balance; warn under US$10,000 (C-21), fail under US$5,000 (S3.9)
// PayPal checks are skipped until PP_CLIENT_ID and PP_CLIENT_SECRET exist. At most 3 PayPal calls per
// run. Output carries only non-secret facts (status codes, webhook id, balance); every line is
// scrubbed of credential values before it is printed.
import { loadDotEnv } from "../apps/tasks/src/env.js";
import { isMain } from "../apps/tasks/src/main.js";

export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

/** Register §8: every webhook event Fair Split subscribes to. */
export const REQUIRED_WEBHOOK_EVENTS: readonly string[] = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
];

/**
 * Exact OAuth scopes the server needs, compared token by token (PayPal returns a space-separated
 * list). Substring matching is wrong here: Transaction Search's `reporting/search/read` would
 * satisfy a `/services/reporting` fragment while `GET /v1/reporting/balances` still returns 403,
 * because that endpoint requires `reporting/balances/read` (PayPal Transaction Search OpenAPI).
 * The REST app needs Invoicing, Payouts, Transaction Search and List Balances ticked.
 */
export const REQUIRED_SCOPES: readonly { label: string; scope: string }[] = [
  { label: "invoicing", scope: "https://uri.paypal.com/services/invoicing" },
  { label: "payouts", scope: "https://uri.paypal.com/services/payments/payouts" },
  { label: "reporting/search", scope: "https://uri.paypal.com/services/reporting/search/read" },
  { label: "reporting/balances", scope: "https://uri.paypal.com/services/reporting/balances/read" },
];

/** Labels of required scopes missing from a token's space-separated `scope` string. */
export function missingScopes(scope: string): string[] {
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.filter((s) => !granted.has(s.scope)).map((s) => s.label);
}

export const BALANCE_WARN_CENTS = 1_000_000; // US$10,000 (register C-21)
export const BALANCE_FAIL_CENTS = 500_000; // US$5,000 (S3.9: posts switch to replay)

const SECRET_ENV_NAMES = [
  "PP_CLIENT_ID",
  "PP_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "RENDER_API_KEY",
  "GEMINI_API_KEY",
];

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface HealthCheckDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly fetch: typeof fetch;
  /** fs-api origin, e.g. https://fs-api.onrender.com. Falls back to FS_API_ORIGIN. */
  readonly origin?: string | undefined;
  readonly timeoutMs?: number;
}

function present(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Decimal string to integer cents without floating point ("12345.6" -> 1234560). */
export function toCents(value: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`not a money amount: ${value}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" ? -cents : cents;
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}US$${whole}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** Replace any credential value (and bearer tokens) that might appear in `text`. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join("REDACTED");
  return out.replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 REDACTED");
}

async function httpCheck(
  name: string,
  url: string,
  deps: HealthCheckDeps,
  warnOnly: boolean,
): Promise<CheckResult> {
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000) });
    await res.body?.cancel();
    if (res.ok) return { name, status: "ok", detail: `${res.status}` };
    return { name, status: warnOnly ? "warn" : "fail", detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: `unreachable (${err instanceof Error ? err.name : "error"})` };
  }
}

interface WebhookListBody {
  webhooks?: { id?: string; url?: string; event_types?: { name?: string }[] }[];
}

interface BalancesBody {
  balances?: { currency?: string; available_balance?: { currency_code?: string; value?: string } }[];
}

export async function runHealthChecks(deps: HealthCheckDeps): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const origin = (deps.origin ?? present(deps.env, "FS_API_ORIGIN"))?.replace(/\/+$/, "");
  const timeout = () => AbortSignal.timeout(deps.timeoutMs ?? 10_000);

  if (origin) {
    results.push(await httpCheck("api.healthz", `${origin}/healthz`, deps, false));
    results.push(await httpCheck("api.readyz", `${origin}/readyz`, deps, true));
  } else {
    results.push({ name: "api.healthz", status: "skip", detail: "no --origin or FS_API_ORIGIN" });
    results.push({ name: "api.readyz", status: "skip", detail: "no --origin or FS_API_ORIGIN" });
  }

  const ppEnv = present(deps.env, "PP_ENV") ?? "sandbox";
  if (ppEnv !== "sandbox") {
    results.push({
      name: "paypal.env",
      status: "fail",
      detail: `PP_ENV is "${ppEnv}"; only sandbox is allowed`,
    });
    return results;
  }
  results.push({ name: "paypal.env", status: "ok", detail: "sandbox" });

  const clientId = present(deps.env, "PP_CLIENT_ID");
  const clientSecret = present(deps.env, "PP_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    for (const name of ["paypal.token", "paypal.webhook", "paypal.balance"]) {
      results.push({ name, status: "skip", detail: "PP_CLIENT_ID / PP_CLIENT_SECRET not set" });
    }
    return results;
  }

  // 1 of 3 PayPal calls: OAuth.
  let token: string;
  try {
    const res = await deps.fetch(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: timeout(),
    });
    if (!res.ok) {
      results.push({ name: "paypal.token", status: "fail", detail: `HTTP ${res.status}` });
      return results;
    }
    const body = (await res.json()) as { access_token?: string; scope?: string; expires_in?: number };
    if (!body.access_token) {
      results.push({ name: "paypal.token", status: "fail", detail: "no access token in response" });
      return results;
    }
    token = body.access_token;
    const scope = body.scope ?? "";
    const missing = missingScopes(scope);
    results.push({
      name: "paypal.token",
      status: missing.length ? "fail" : "ok",
      detail: missing.length
        ? `scope missing: ${missing.join(", ")}`
        : `scope covers ${REQUIRED_SCOPES.map((s) => s.label).join(", ")}; expires in ${body.expires_in ?? "?"} s`,
    });
  } catch (err) {
    results.push({
      name: "paypal.token",
      status: "fail",
      detail: `unreachable (${err instanceof Error ? err.name : "error"})`,
    });
    return results;
  }
  const auth = { authorization: `Bearer ${token}`, accept: "application/json" };

  // 2 of 3: webhook registration.
  try {
    const res = await deps.fetch(`${PAYPAL_SANDBOX_BASE}/v1/notifications/webhooks`, {
      headers: auth,
      signal: timeout(),
    });
    if (!res.ok) {
      results.push({ name: "paypal.webhook", status: "fail", detail: `HTTP ${res.status}` });
    } else {
      const body = (await res.json()) as WebhookListBody;
      const hooks = body.webhooks ?? [];
      const wantId = present(deps.env, "PP_WEBHOOK_ID");
      const wantUrl = origin ? `${origin}/webhooks/paypal` : undefined;
      const hook = hooks.find((h) => (wantId ? h.id === wantId : wantUrl !== undefined && h.url === wantUrl));
      if (!hook) {
        results.push({
          name: "paypal.webhook",
          status: "fail",
          detail: wantId
            ? `webhook ${wantId} not registered (${hooks.length} on app)`
            : "no PP_WEBHOOK_ID and no matching URL",
        });
      } else {
        const names = new Set((hook.event_types ?? []).map((e) => e.name));
        const wildcard = names.has("*");
        const missing = wildcard ? [] : REQUIRED_WEBHOOK_EVENTS.filter((e) => !names.has(e));
        const urlDrift = wantUrl !== undefined && hook.url !== wantUrl;
        const problems = [
          ...(urlDrift ? [`url drift (registered ${hook.url ?? "?"})`] : []),
          ...(missing.length ? [`missing ${missing.length} events: ${missing.join(", ")}`] : []),
        ];
        results.push({
          name: "paypal.webhook",
          status: problems.length ? "fail" : "ok",
          detail: problems.length
            ? `${hook.id}: ${problems.join("; ")}`
            : `${hook.id}: ${wildcard ? "all events (*)" : `${REQUIRED_WEBHOOK_EVENTS.length} events`}`,
        });
      }
    }
  } catch (err) {
    results.push({
      name: "paypal.webhook",
      status: "fail",
      detail: `unreachable (${err instanceof Error ? err.name : "error"})`,
    });
  }

  // 3 of 3: balance.
  try {
    const res = await deps.fetch(`${PAYPAL_SANDBOX_BASE}/v1/reporting/balances?currency_code=USD`, {
      headers: auth,
      signal: timeout(),
    });
    if (res.status === 403) {
      // Without the balance the US$5k guard is blind, so this is an outage of the check, not a note.
      results.push({
        name: "paypal.balance",
        status: "fail",
        detail: "HTTP 403: REST app lacks List Balances (scope reporting/balances/read)",
      });
    } else if (!res.ok) {
      results.push({ name: "paypal.balance", status: "fail", detail: `HTTP ${res.status}` });
    } else {
      const body = (await res.json()) as BalancesBody;
      const usd = (body.balances ?? []).find(
        (b) => (b.currency ?? b.available_balance?.currency_code) === "USD",
      );
      const value = usd?.available_balance?.value;
      if (value === undefined) {
        results.push({ name: "paypal.balance", status: "warn", detail: "no USD balance reported" });
      } else {
        const cents = toCents(value);
        const status: CheckStatus =
          cents < BALANCE_FAIL_CENTS ? "fail" : cents < BALANCE_WARN_CENTS ? "warn" : "ok";
        results.push({ name: "paypal.balance", status, detail: `${formatUsd(cents)} available` });
      }
    }
  } catch (err) {
    results.push({
      name: "paypal.balance",
      status: "fail",
      detail: `unreachable (${err instanceof Error ? err.name : "error"})`,
    });
  }

  return results;
}

export function renderResults(
  results: readonly CheckResult[],
  env: NodeJS.ProcessEnv,
  json: boolean,
): string {
  const secrets = SECRET_ENV_NAMES.map((n) => present(env, n)).filter((v): v is string => v !== undefined);
  const text = json
    ? JSON.stringify({ at: new Date().toISOString(), results }, null, 2)
    : results.map((r) => `${r.status.toUpperCase().padEnd(4)}  ${r.name.padEnd(15)}  ${r.detail}`).join("\n");
  return scrub(text, secrets);
}

export function exitCodeFor(results: readonly CheckResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export function parseArgs(argv: readonly string[]): { origin?: string; json: boolean } {
  let origin: string | undefined;
  let json = false;
  for (const a of argv) {
    if (a === "--json") json = true;
    else if (a.startsWith("--origin=")) origin = a.slice("--origin=".length);
    else throw new Error(`unknown argument: ${a}`);
  }
  return origin ? { origin, json } : { json };
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  runHealthChecks({ env: process.env, fetch, origin: args.origin }).then(
    (results) => {
      console.log(renderResults(results, process.env, args.json));
      process.exitCode = exitCodeFor(results);
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.name : "error");
      process.exitCode = 1;
    },
  );
}
