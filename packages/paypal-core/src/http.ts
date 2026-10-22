// PayPalHttp.request(): the only door to PayPal's REST APIs (IC-05, architecture §6.1, S3.6.2).
//
// Every call: takes a token from the injected limiter (40/min across services, 20 background, a
// 6-minute circuit after a 429), attaches the shared OAuth token and `PayPal-Request-Id`, times
// out after 15 s, records one `paypal_calls` row per attempt, and returns a discriminated result
// union that always carries `debugId` (null only when PayPal never answered). It never throws.
//
// Retries: idempotent calls (GET, or anything with a PayPal-Request-Id) are retried on 5xx,
// timeouts and network errors at 1 s, 3 s and 9 s, with the same request id (S3.6.4). A 401
// invalidates the token and retries once. A 429 opens the circuit and is returned at once.
// `delivery` tells money code whether PayPal could have acted on the request.

import { z } from "zod";
import type { PayPalAuth, PayPalToken } from "./auth.js";
import { PAYPAL_API_BASE_URL, PAYPAL_API_HOSTS, type PayPalEnv } from "./env.js";
import { PayPalAuthError, PayPalConfigError, type PayPalErrorName, PayPalHttpError } from "./errors.js";
import { LIMITER_DEFAULTS, type PayPalLimiter } from "./limiter.js";
import { type CallOutcome, type PayPalCallRecorder, recordSafely } from "./recorder.js";
import {
  type CallPriority,
  type CallPurpose,
  defaultFetch,
  type FetchLike,
  type LoggerLike,
} from "./types.js";
import { clip, isTimeoutError, normalizeBaseUrl, parseJsonLoose, parseRetryAfter, sleep } from "./util.js";

export type HttpMethod = "GET" | "POST" | "PATCH";

export interface PayPalRequest {
  method: HttpMethod;
  /** `/v1/...` path, or an absolute HATEOAS `href` on one of this environment's PayPal API hosts. */
  path: string;
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  /** JSON body, serialized with JSON.stringify. */
  body?: unknown;
  /** Pre-serialized JSON body, sent byte-for-byte (the postback verify splices the raw webhook in). */
  rawJsonBody?: string;
  /** `PayPal-Request-Id`. Also makes the call retry-safe. */
  requestId?: string;
  purpose: CallPurpose;
  priority: CallPriority;
  /** Safe to repeat? Defaults to true for GET and for calls with a `requestId`. */
  idempotent?: boolean;
  /** Extra headers such as `Prefer`. Authorization, Content-Type and PayPal-Request-Id are always ours. */
  headers?: Readonly<Record<string, string>>;
  /** Per-attempt timeout; defaults to the client's (15 s). */
  timeoutMs?: number;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * - `http`: PayPal answered with a non-2xx status.
 * - `timeout` / `network`: sent, no answer; PayPal may or may not have acted (`delivery: unknown`).
 * - `limited` / `circuit_open`: the limiter refused; nothing was sent.
 * - `auth`: no OAuth token could be obtained; nothing was sent.
 * - `invalid_request`: refused locally (bad path or request id); nothing was sent.
 */
export type PayPalFailureKind =
  | "http"
  | "timeout"
  | "network"
  | "limited"
  | "circuit_open"
  | "auth"
  | "invalid_request";

/** Whether PayPal could have acted on the request: `not_sent` is a guarantee, the others are not. */
export type Delivery = "not_sent" | "unknown" | "received";

export interface PayPalSuccess<T> {
  ok: true;
  status: number;
  body: T;
  debugId: string | null;
  ms: number;
  attempts: number;
  requestId: string | null;
}

export interface PayPalFailure {
  ok: false;
  kind: PayPalFailureKind;
  /** HTTP status, or 0 when PayPal sent no response. */
  status: number;
  name: PayPalErrorName;
  message: string;
  details: PayPalErrorDetail[];
  /** Top-level `links` merged with every `details[].link` (Payouts puts the original batch there). */
  links: PayPalLink[];
  debugId: string | null;
  /** Advisory: is it sensible to try the same call again later? */
  retryable: boolean;
  /** From `Retry-After`, the limiter, or the 429 circuit. */
  retryAfterMs: number | null;
  delivery: Delivery;
  ms: number;
  attempts: number;
  requestId: string | null;
}

export type PayPalResult<T> = PayPalSuccess<T> | PayPalFailure;

export interface PayPalHttp {
  request<T = unknown>(req: PayPalRequest): Promise<PayPalResult<T>>;
}

export interface RetryPolicy {
  /** Wait before each retry; the array length is the retry budget (S3.6.4: 1 s, 3 s, 9 s). */
  delaysMs: readonly number[];
  /** Statuses retried automatically for idempotent calls. */
  retryStatuses: readonly number[];
  /** Cap on honouring a `Retry-After` header. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  delaysMs: Object.freeze([1_000, 3_000, 9_000]),
  retryStatuses: Object.freeze([500, 502, 503, 504]),
  maxRetryAfterMs: 30_000,
});

/** Statuses for which trying again later is sensible (advisory `retryable`). */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface PayPalHttpConfig {
  auth: Pick<PayPalAuth, "token" | "invalidate">;
  limiter: PayPalLimiter;
  env?: PayPalEnv;
  baseUrl?: string;
  allowLive?: boolean;
  recorder?: PayPalCallRecorder;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  logger?: LoggerLike;
}

const LinkSchema = z
  .object({ href: z.string(), rel: z.string(), method: z.string().optional() })
  .passthrough();

const ErrorBodySchema = z
  .object({
    name: z.string().optional(),
    message: z.string().optional(),
    debug_id: z.string().optional(),
    details: z.array(z.record(z.unknown())).optional(),
    links: z.array(z.unknown()).optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .passthrough();

/** Collect valid links from a `links` array, or a single link object. */
function linksFrom(value: unknown): PayPalLink[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: PayPalLink[] = [];
  for (const item of items) {
    const parsed = LinkSchema.safeParse(item);
    if (parsed.success) {
      out.push(
        parsed.data.method === undefined
          ? { href: parsed.data.href, rel: parsed.data.rel }
          : { href: parsed.data.href, rel: parsed.data.rel, method: parsed.data.method },
      );
    }
  }
  return out;
}

/** Parse PayPal's error body (REST `{name, message, debug_id, details, links}` or OAuth `{error, error_description}`). */
export function parsePayPalError(
  status: number,
  body: unknown,
): {
  name: PayPalErrorName;
  message: string;
  details: PayPalErrorDetail[];
  links: PayPalLink[];
  debugId: string | null;
} {
  const parsed = ErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return { name: `HTTP_${status}`, message: `HTTP ${status}`, details: [], links: [], debugId: null };
  }
  const data = parsed.data;
  const details = (data.details ?? []) as PayPalErrorDetail[];
  const links = [
    ...linksFrom(data.links),
    ...details.flatMap((d) => [...linksFrom(d.link), ...linksFrom(d.links)]),
  ];
  const seen = new Set<string>();
  const unique = links.filter((l) => {
    const key = `${l.rel} ${l.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    name: data.name ?? data.error ?? `HTTP_${status}`,
    message: clip(data.message ?? data.error_description ?? `HTTP ${status}`, 500),
    details,
    links: unique,
    debugId: data.debug_id ?? null,
  };
}

const REQUEST_ID = /^[\x21-\x7e]{1,1000}$/;
const API_PATH = /^\/v\d+\//;

type Target = { ok: true; url: string; path: string } | { ok: false; message: string };

function resolveTarget(
  baseUrl: string,
  allowedHosts: readonly string[],
  path: string,
  query: PayPalRequest["query"],
): Target {
  let url: URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    let absolute: URL;
    try {
      absolute = new URL(path);
    } catch {
      return { ok: false, message: "invalid absolute URL" };
    }
    if (
      absolute.protocol !== "https:" ||
      absolute.username ||
      absolute.password ||
      absolute.port !== "" ||
      !allowedHosts.includes(absolute.hostname)
    ) {
      return { ok: false, message: "absolute URL is not on an allowed PayPal API host" };
    }
    url = new URL(`${absolute.pathname}${absolute.search}`, baseUrl);
  } else {
    if (!path.startsWith("/") || path.startsWith("//"))
      return { ok: false, message: "path must start with /" };
    url = new URL(path, baseUrl);
  }
  if (url.origin !== baseUrl || !API_PATH.test(url.pathname)) {
    return { ok: false, message: "path must be a PayPal REST path such as /v1/..." };
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return { ok: true, url: url.href, path: url.pathname };
}

export function createPayPalHttp(config: PayPalHttpConfig): PayPalHttp {
  const env = config.env ?? "sandbox";
  if (env === "live" && config.allowLive !== true) {
    throw new PayPalConfigError(
      "LIVE_DISABLED",
      "Fair Split runs on the PayPal sandbox only (PP_ENV=sandbox)",
    );
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? PAYPAL_API_BASE_URL[env]);
  const allowedHosts = [...new Set([new URL(baseUrl).hostname, ...PAYPAL_API_HOSTS[env]])];
  const fetchImpl = config.fetch ?? defaultFetch;
  const now = config.now ?? Date.now;
  const wait = config.sleep ?? sleep;
  const defaultTimeoutMs = config.timeoutMs ?? 15_000;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...config.retry };
  const { auth, limiter, logger } = config;

  async function request<T>(req: PayPalRequest): Promise<PayPalResult<T>> {
    const startedAt = now();
    const requestId = req.requestId ?? null;
    let attempts = 0;
    let delivery: Delivery = "not_sent";

    const fail = (
      f: Omit<PayPalFailure, "ok" | "ms" | "attempts" | "requestId" | "delivery"> & { delivery?: Delivery },
    ) => {
      const failure: PayPalFailure = {
        ok: false,
        ...f,
        delivery: f.delivery ?? delivery,
        ms: now() - startedAt,
        attempts,
        requestId,
      };
      return failure;
    };
    const local = (
      kind: PayPalFailureKind,
      name: PayPalErrorName,
      message: string,
      extra: Partial<Pick<PayPalFailure, "status" | "debugId" | "retryable" | "retryAfterMs">> = {},
    ) =>
      fail({
        kind,
        status: 0,
        name,
        message,
        details: [],
        links: [],
        debugId: null,
        retryable: false,
        retryAfterMs: null,
        ...extra,
      });

    if (requestId !== null && !REQUEST_ID.test(requestId)) {
      return local(
        "invalid_request",
        "FS_INVALID_REQUEST",
        "PayPal-Request-Id must be 1-1000 printable ASCII characters",
      );
    }
    if (req.body !== undefined && req.rawJsonBody !== undefined) {
      return local("invalid_request", "FS_INVALID_REQUEST", "pass either body or rawJsonBody, not both");
    }
    const target = resolveTarget(baseUrl, allowedHosts, req.path, req.query);
    if (!target.ok) return local("invalid_request", "FS_INVALID_REQUEST", target.message);

    const idempotent = req.idempotent ?? (req.method === "GET" || requestId !== null);
    const bodyText = req.rawJsonBody ?? (req.body === undefined ? undefined : JSON.stringify(req.body));
    const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;
    let retriesUsed = 0;
    let authRetried = false;

    const record = (
      status: number,
      outcome: CallOutcome,
      debugId: string | null,
      attemptStart: number,
      ticket: string | null,
    ) =>
      recordSafely(
        config.recorder,
        {
          at: new Date(attemptStart),
          purpose: req.purpose,
          priority: req.priority,
          method: req.method,
          path: target.path,
          status,
          outcome,
          debugId,
          requestId,
          ms: now() - attemptStart,
          attempt: attempts,
          ticket,
        },
        logger,
      );

    const nextRetryDelay = (retryAfter: number | null): number | null => {
      if (!idempotent || retriesUsed >= policy.delaysMs.length) return null;
      const base = policy.delaysMs[retriesUsed] ?? 0;
      retriesUsed += 1;
      return Math.max(base, Math.min(retryAfter ?? 0, policy.maxRetryAfterMs));
    };

    for (;;) {
      const gate = await limiter.take({ purpose: req.purpose, priority: req.priority });
      if (!gate.ok) {
        const circuit = gate.reason === "CIRCUIT_OPEN";
        return local(
          circuit ? "circuit_open" : "limited",
          circuit ? "FS_CIRCUIT_OPEN" : "FS_LIMITER_DENIED",
          circuit ? "PayPal circuit open after a 429; replay is labelled" : `limiter denied (${gate.reason})`,
          { retryable: true, retryAfterMs: gate.retryAfterMs },
        );
      }

      let token: PayPalToken;
      try {
        token = await auth.token();
      } catch (err) {
        const authErr = err instanceof PayPalAuthError ? err : null;
        return local("auth", "FS_AUTH_FAILED", authErr?.message ?? "PayPal OAuth token unavailable", {
          status: authErr?.status ?? 0,
          debugId: authErr?.debugId ?? null,
          retryable: authErr === null || authErr.kind !== "http" || authErr.status >= 500,
        });
      }

      attempts += 1;
      const attemptStart = now();
      const headers = new Headers(req.headers);
      headers.set("authorization", `Bearer ${token.v}`);
      headers.set("accept", "application/json");
      if (bodyText !== undefined) headers.set("content-type", "application/json");
      else headers.delete("content-type");
      if (requestId !== null) headers.set("paypal-request-id", requestId);
      else headers.delete("paypal-request-id");

      let res: Response;
      try {
        res = await fetchImpl(target.url, {
          method: req.method,
          headers,
          ...(bodyText === undefined ? {} : { body: bodyText }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = isTimeoutError(err);
        // Sent, no answer: PayPal may or may not have acted on this attempt.
        delivery = "unknown";
        await record(0, timedOut ? "timeout" : "network_error", null, attemptStart, gate.ticket ?? null);
        const delay = nextRetryDelay(null);
        if (delay !== null) {
          logger?.warn?.(
            { purpose: req.purpose, attempt: attempts, delayMs: delay },
            "paypal call retry (no response)",
          );
          await wait(delay);
          continue;
        }
        return local(
          timedOut ? "timeout" : "network",
          timedOut ? "FS_TIMEOUT" : "FS_NETWORK_ERROR",
          timedOut ? `no response within ${timeoutMs} ms` : "network error before a response",
          { retryable: idempotent },
        );
      }

      delivery = "received";
      const headerDebugId = res.headers.get("paypal-debug-id");
      const text = await res.text().catch(() => "");
      const json = parseJsonLoose(text);
      await record(
        res.status,
        res.ok ? "ok" : "http_error",
        headerDebugId,
        attemptStart,
        gate.ticket ?? null,
      );

      if (res.ok) {
        const body = json === undefined ? (text === "" ? null : text) : json;
        return {
          ok: true,
          status: res.status,
          body: body as T,
          debugId: headerDebugId,
          ms: now() - startedAt,
          attempts,
          requestId,
        };
      }

      if (res.status === 401 && !authRetried) {
        authRetried = true;
        auth.invalidate(token.v);
        continue;
      }

      const error = parsePayPalError(res.status, json);
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now());
      if (res.status === 429) {
        try {
          await limiter.reportRateLimited?.(new Date(now()));
        } catch (err) {
          logger?.error?.(
            { error: err instanceof Error ? err.message : String(err) },
            "limiter.reportRateLimited failed",
          );
        }
        return fail({
          kind: "http",
          status: 429,
          ...error,
          debugId: headerDebugId ?? error.debugId,
          retryable: true,
          retryAfterMs: retryAfter ?? LIMITER_DEFAULTS.circuitMs,
        });
      }

      if (policy.retryStatuses.includes(res.status)) {
        const delay = nextRetryDelay(retryAfter);
        if (delay !== null) {
          logger?.warn?.(
            {
              purpose: req.purpose,
              status: res.status,
              debugId: headerDebugId,
              attempt: attempts,
              delayMs: delay,
            },
            "paypal call retry",
          );
          await wait(delay);
          continue;
        }
      }

      return fail({
        kind: "http",
        status: res.status,
        ...error,
        debugId: headerDebugId ?? error.debugId,
        retryable: RETRYABLE_STATUSES.has(res.status),
        retryAfterMs: retryAfter,
      });
    }
  }

  return { request };
}

/** Return the body of a successful result, or throw `PayPalHttpError` carrying the whole failure. */
export function expectOk<T>(result: PayPalResult<T>): T {
  if (result.ok) return result.body;
  throw new PayPalHttpError(result);
}
