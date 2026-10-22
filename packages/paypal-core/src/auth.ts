// PayPalAuth: OAuth 2.0 client-credentials with one shared, single-flight token cache per process
// (register §8, architecture §6.1, S3.6.2).
//
// - Concurrent callers share one in-flight `POST /v1/oauth2/token`; PayPalHttp, the toolkit runner
//   and the server SDK all read this cache, so token calls never eat into the 50/min sandbox budget.
// - The token is refreshed 5 minutes before `expires_in` runs out. If that early refresh fails while
//   the old token still has at least 30 s left, the old token keeps being served (and the refresh is
//   retried after 15 s) instead of failing the call.
// - `invalidate(token)` drops the cached token after a 401; the caller retries once.
// - The bearer value is a non-enumerable property, so JSON.stringify, util.inspect and pino never
//   print it. The client secret lives only inside this closure.

import { z } from "zod";
import { PAYPAL_API_BASE_URL, type PayPalEnv } from "./env.js";
import { PayPalAuthError, PayPalConfigError } from "./errors.js";
import { type PayPalCallRecorder, recordSafely } from "./recorder.js";
import { checkScopes, type ScopeReport } from "./scopes.js";
import { defaultFetch, type FetchLike, type LoggerLike } from "./types.js";
import { isTimeoutError, normalizeBaseUrl, parseJsonLoose } from "./util.js";

/** Refresh this long before PayPal's `expires_in` (register §8: "refreshed 5 minutes before expiry"). */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;
/** Never hand out a token with less than this much life left. */
const STALE_GRACE_MS = 30_000;
/** After a failed early refresh, keep serving the old token this long before trying again. */
const REFRESH_BACKOFF_MS = 15_000;

export interface PayPalToken {
  /** Bearer token. Non-enumerable: invisible to JSON.stringify, util.inspect and loggers. */
  readonly v: string;
  /** Expiry in epoch ms, counted from when the token request was sent. */
  readonly exp: number;
  /** Space-separated `scope` from PayPal, split. */
  readonly scopes: readonly string[];
  readonly appId: string | null;
}

export interface PayPalAuthStatus {
  hasToken: boolean;
  expiresAt: number | null;
  refreshAt: number | null;
  /** Token requests sent to PayPal by this process. */
  fetches: number;
  failures: number;
  lastError: string | null;
}

export interface PayPalAuth {
  /** A valid token; single-flight across concurrent callers. */
  token(): Promise<PayPalToken>;
  /** Drop the cached token after a 401. With an argument, only if it is still the cached one. */
  invalidate(staleToken?: string): void;
  /** Scope report for the boot check, `/readyz` and the capabilities panel. */
  capabilities(): Promise<ScopeReport>;
  /** Cache state for `/ops`. Never includes the token. */
  status(): PayPalAuthStatus;
}

export interface PayPalAuthConfig {
  clientId: string;
  clientSecret: string;
  env?: PayPalEnv;
  /** Override the API origin (must be https on a paypal.com host). Defaults to the env's base URL. */
  baseUrl?: string;
  /** Fair Split is sandbox-only; `live` is refused unless this is set. */
  allowLive?: boolean;
  fetch?: FetchLike;
  now?: () => number;
  refreshSkewMs?: number;
  timeoutMs?: number;
  recorder?: PayPalCallRecorder;
  logger?: LoggerLike;
}

const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().optional(),
    expires_in: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
    scope: z.string().optional(),
    app_id: z.string().optional(),
  })
  .passthrough();

const OAuthErrorSchema = z
  .object({ error: z.string().optional(), error_description: z.string().optional() })
  .passthrough();

function makeToken(value: string, exp: number, scopes: string[], appId: string | null): PayPalToken {
  const token = { exp, scopes: Object.freeze(scopes), appId };
  Object.defineProperty(token, "v", { value, enumerable: false, writable: false, configurable: false });
  return Object.freeze(token) as PayPalToken;
}

export function createPayPalAuth(config: PayPalAuthConfig): PayPalAuth {
  const env = config.env ?? "sandbox";
  if (env === "live" && config.allowLive !== true) {
    throw new PayPalConfigError(
      "LIVE_DISABLED",
      "Fair Split runs on the PayPal sandbox only (PP_ENV=sandbox)",
    );
  }
  if (!config.clientId || !config.clientSecret) {
    throw new PayPalConfigError("MISSING_ENV", "PayPal client id and client secret are required", [
      "PP_CLIENT_ID",
      "PP_CLIENT_SECRET",
    ]);
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? PAYPAL_API_BASE_URL[env]);
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const fetchImpl = config.fetch ?? defaultFetch;
  const now = config.now ?? Date.now;
  const skewMs = config.refreshSkewMs ?? TOKEN_REFRESH_SKEW_MS;
  const timeoutMs = config.timeoutMs ?? 15_000;

  let cached: PayPalToken | null = null;
  let inflight: Promise<PayPalToken> | null = null;
  let refreshBlockedUntil = 0;
  let fetches = 0;
  let failures = 0;
  let lastError: string | null = null;

  async function fetchToken(): Promise<PayPalToken> {
    fetches += 1;
    const sentAt = now();
    const record = (
      status: number,
      outcome: "ok" | "http_error" | "timeout" | "network_error",
      debugId: string | null,
    ) =>
      recordSafely(
        config.recorder,
        {
          at: new Date(sentAt),
          purpose: "oauth.token",
          priority: "live",
          method: "POST",
          path: "/v1/oauth2/token",
          status,
          outcome,
          debugId,
          requestId: null,
          ms: now() - sentAt,
          attempt: 1,
          ticket: null,
        },
        config.logger,
      );

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: "grant_type=client_credentials",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = isTimeoutError(err);
      await record(0, timedOut ? "timeout" : "network_error", null);
      throw new PayPalAuthError(
        timedOut ? "timeout" : "network",
        timedOut
          ? `PayPal OAuth request timed out after ${timeoutMs} ms`
          : "PayPal OAuth request failed (network)",
        0,
        null,
        null,
      );
    }

    const debugId = res.headers.get("paypal-debug-id");
    const json = parseJsonLoose(await res.text().catch(() => ""));
    await record(res.status, res.ok ? "ok" : "http_error", debugId);

    if (!res.ok) {
      const parsed = OAuthErrorSchema.safeParse(json);
      const code = parsed.success ? (parsed.data.error ?? null) : null;
      throw new PayPalAuthError(
        "http",
        `PayPal OAuth failed with HTTP ${res.status}${code ? ` (${code})` : ""}`,
        res.status,
        code,
        debugId,
      );
    }
    const parsed = TokenResponseSchema.safeParse(json);
    if (!parsed.success || (parsed.data.token_type && parsed.data.token_type.toLowerCase() !== "bearer")) {
      throw new PayPalAuthError(
        "invalid_response",
        "PayPal OAuth response did not have the expected shape",
        res.status,
        null,
        debugId,
      );
    }
    const scopes = (parsed.data.scope ?? "").split(/\s+/).filter((s) => s.length > 0);
    return makeToken(
      parsed.data.access_token,
      sentAt + parsed.data.expires_in * 1000,
      scopes,
      parsed.data.app_id ?? null,
    );
  }

  function startRefresh(): Promise<PayPalToken> {
    if (inflight) return inflight;
    const run = (async () => {
      try {
        const fresh = await fetchToken();
        cached = fresh;
        lastError = null;
        refreshBlockedUntil = 0;
        return fresh;
      } catch (err) {
        failures += 1;
        lastError = err instanceof Error ? err.message : String(err);
        refreshBlockedUntil = now() + REFRESH_BACKOFF_MS;
        throw err;
      } finally {
        inflight = null;
      }
    })();
    inflight = run;
    return run;
  }

  const usable = (t: PayPalToken | null, at: number): t is PayPalToken =>
    t !== null && at < t.exp - STALE_GRACE_MS;

  async function token(): Promise<PayPalToken> {
    const t = now();
    if (cached && t < cached.exp - skewMs) return cached;
    // Inside the early-refresh window after a failed refresh: serve the old token for a while.
    if (usable(cached, t) && t < refreshBlockedUntil && !inflight) return cached;
    try {
      return await startRefresh();
    } catch (err) {
      if (usable(cached, now())) {
        config.logger?.warn?.({ error: lastError }, "paypal token refresh failed; serving the current token");
        return cached;
      }
      throw err;
    }
  }

  return {
    token,
    invalidate(staleToken) {
      if (staleToken === undefined || cached?.v === staleToken) {
        cached = null;
        refreshBlockedUntil = 0;
      }
    },
    async capabilities() {
      return checkScopes((await token()).scopes);
    },
    status() {
      return {
        hasToken: cached !== null,
        expiresAt: cached?.exp ?? null,
        refreshAt: cached ? cached.exp - skewMs : null,
        fetches,
        failures,
        lastError,
      };
    },
  };
}
