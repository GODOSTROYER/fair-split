/**
 * The PayPal limiter (register §8, S3.6.2). Every service sends PayPal traffic from one egress IP and the
 * sandbox blocks an IP for 5 minutes past 50 calls a minute, so the budget lives in Postgres:
 *
 * - at most 40 calls in any sliding 60 s window, across all services;
 * - at most 20 of them at background priority, so live judges always keep 20;
 * - a 429 opens a 6-minute circuit (longer than PayPal's 5-minute block). The circuit is derived from the
 *   `paypal_calls` table (a 429 recorded in the last 6 minutes), never stored, so every process agrees.
 *
 * `take()` decides under a transaction-scoped advisory lock and, when it grants, inserts the `paypal_calls`
 * row that occupies the slot. `record()` completes that row with the HTTP status, debug id and latency.
 * A denial carries `retryAfterMs` for the "PayPal's sandbox is pacing us. You're next, about 40 s." copy.
 * Denial reasons are paypal-core's (`WINDOW_FULL`, `BACKGROUND_SHARE_FULL`, `CIRCUIT_OPEN`), and
 * `paypalCoreLimiter(limiter)` gives paypal-core's `PayPalLimiter` and `PayPalCallRecorder` over it.
 *
 * The window is read with the current instant computed once and compared through the `paypal_calls.at` index:
 * `at > clock_timestamp() - …` in a WHERE is volatile and forces a sequential scan of the whole table under the
 * global lock, which grows with the table (kept rows are pruned by `pruneKeptRows`).
 */
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { paypalCalls } from "./schema/index.js";

export type CallPriority = "live" | "background";

export interface LimiterConfig {
  perWindow: number;
  backgroundPerWindow: number;
  windowMs: number;
  circuitMs: number;
}

export const LIMITER_DEFAULTS: LimiterConfig = {
  perWindow: 40,
  backgroundPerWindow: 20,
  windowMs: 60_000,
  circuitMs: 6 * 60_000,
};

export interface TakeRequest {
  /** e.g. toolkit:create_invoice, payouts:create_payout_batch, webhooks:resend */
  purpose: string;
  priority: CallPriority;
  workspaceId?: string | null;
  method?: string;
  path?: string;
  requestId?: string;
}

/** paypal-core's `LimiterDenyReason`, name for name. */
export type DenyReason = "WINDOW_FULL" | "BACKGROUND_SHARE_FULL" | "CIRCUIT_OPEN";

export type TakeResult =
  | { ok: true; callId: string; at: Date }
  | { ok: false; reason: DenyReason; retryAfterMs: number };

export interface CallOutcome {
  status: number | null;
  debugId?: string | null;
  ms: number;
  error?: string | null;
  /** known only once the request is built (paypal-core's take() names purpose and priority alone) */
  method?: string | null;
  path?: string | null;
  requestId?: string | null;
}

export interface LimiterState {
  inWindow: number;
  backgroundInWindow: number;
  circuitOpenUntil: Date | null;
  limits: LimiterConfig;
}

export interface Limiter {
  take(req: TakeRequest): Promise<TakeResult>;
  /** take, waiting out WINDOW_FULL/BACKGROUND_SHARE_FULL denials up to maxWaitMs; CIRCUIT_OPEN returns at once */
  acquire(req: TakeRequest, opts?: { maxWaitMs?: number; signal?: AbortSignal }): Promise<TakeResult>;
  record(callId: string, outcome: CallOutcome): Promise<void>;
  /** a finished call that took no slot here (e.g. made under another limiter): it still counts in the window */
  insertCompleted(call: CompletedCall): Promise<void>;
  state(): Promise<LimiterState>;
}

export interface CompletedCall {
  at: Date;
  purpose: string;
  priority: CallPriority;
  workspaceId?: string | null;
  method?: string | null;
  path?: string | null;
  status: number | null;
  debugId?: string | null;
  requestId?: string | null;
  ms: number;
  error?: string | null;
}

const LOCK_KEY = "fs:paypal-limiter";

interface WindowRow {
  now: Date;
  in_window: string;
  bg_in_window: string;
  oldest: Date | null;
  oldest_bg: Date | null;
  last_429: Date | null;
}

/**
 * The window and circuit as one row. The instant is taken once (`c.now`, the wall clock, not the transaction start)
 * and every comparison with it is a parameter of an index scan: `paypal_calls_at_idx` for the window,
 * `paypal_calls_429_idx` for the circuit. Exported for the plan test.
 * @internal
 */
export function limiterWindowQuery(cfg: Pick<LimiterConfig, "windowMs" | "circuitMs">): SQL {
  const windowSec = Math.max(cfg.windowMs / 1000, 0.001);
  const circuitSec = cfg.circuitMs / 1000;
  return sql`
    select c.now,
           count(p.at) as in_window,
           count(p.at) filter (where p.priority = 'background') as bg_in_window,
           min(p.at) as oldest,
           min(p.at) filter (where p.priority = 'background') as oldest_bg,
           (select max(q.responded_at) from ${paypalCalls} q
             where q.status = 429 and q.responded_at > c.now - make_interval(secs => ${circuitSec})) as last_429
      from (select clock_timestamp() as now) c
      left join ${paypalCalls} p on p.at > c.now - make_interval(secs => ${windowSec})
     group by c.now`;
}

export function createLimiter(db: Db, config: Partial<LimiterConfig> = {}): Limiter {
  const cfg: LimiterConfig = { ...LIMITER_DEFAULTS, ...config };
  const windowQuery = limiterWindowQuery(cfg);

  const readWindow = async (q: Pick<Db, "execute">): Promise<WindowRow> => {
    const res = await q.execute(windowQuery);
    const row = (res as unknown as WindowRow[])[0];
    if (!row) throw new Error("limiter: window query returned nothing");
    return {
      ...row,
      now: toDate(row.now) as Date,
      oldest: toDate(row.oldest),
      oldest_bg: toDate(row.oldest_bg),
      last_429: toDate(row.last_429),
    };
  };

  const take = async (req: TakeRequest): Promise<TakeResult> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0))`);
      const w = await readWindow(tx);
      const now = w.now.getTime();
      if (w.last_429) {
        return {
          ok: false,
          reason: "CIRCUIT_OPEN",
          retryAfterMs: Math.max(1, w.last_429.getTime() + cfg.circuitMs - now),
        };
      }
      if (Number(w.in_window) >= cfg.perWindow) {
        const oldest = w.oldest?.getTime() ?? now;
        return { ok: false, reason: "WINDOW_FULL", retryAfterMs: Math.max(1, oldest + cfg.windowMs - now) };
      }
      if (req.priority === "background" && Number(w.bg_in_window) >= cfg.backgroundPerWindow) {
        const oldest = w.oldest_bg?.getTime() ?? now;
        return {
          ok: false,
          reason: "BACKGROUND_SHARE_FULL",
          retryAfterMs: Math.max(1, oldest + cfg.windowMs - now),
        };
      }
      const [row] = await tx
        .insert(paypalCalls)
        .values({
          workspaceId: req.workspaceId ?? null,
          purpose: req.purpose,
          priority: req.priority,
          method: req.method ?? null,
          path: req.path ?? null,
          requestId: req.requestId ?? null,
        })
        .returning({ id: paypalCalls.id, at: paypalCalls.at });
      if (!row) throw new Error("limiter: insert returned no row");
      return { ok: true, callId: row.id, at: row.at };
    });

  const acquire: Limiter["acquire"] = async (req, opts = {}) => {
    const deadline = Date.now() + (opts.maxWaitMs ?? 0);
    for (;;) {
      const r = await take(req);
      if (r.ok || r.reason === "CIRCUIT_OPEN") return r;
      const wait = Math.min(r.retryAfterMs, deadline - Date.now());
      if (wait <= 0) return r;
      await sleep(wait + 5, opts.signal);
      if (opts.signal?.aborted) return r;
    }
  };

  const record: Limiter["record"] = async (callId, o) => {
    await db.execute(sql`
      update ${paypalCalls}
         set status = ${o.status}, debug_id = ${o.debugId ?? null}, ms = ${Math.round(o.ms)},
             error = ${o.error ?? null}, responded_at = clock_timestamp(),
             method = coalesce(${o.method ?? null}, method), path = coalesce(${o.path ?? null}, path),
             request_id = coalesce(${o.requestId ?? null}, request_id)
       where id = ${callId}`);
  };

  const state: Limiter["state"] = async () => {
    const w = await readWindow(db);
    return {
      inWindow: Number(w.in_window),
      backgroundInWindow: Number(w.bg_in_window),
      circuitOpenUntil: w.last_429 ? new Date(w.last_429.getTime() + cfg.circuitMs) : null,
      limits: cfg,
    };
  };

  const insertCompleted: Limiter["insertCompleted"] = async (c) => {
    await db.insert(paypalCalls).values({
      workspaceId: c.workspaceId ?? null,
      at: c.at,
      purpose: c.purpose,
      priority: c.priority,
      method: c.method ?? null,
      path: c.path ?? null,
      status: c.status,
      debugId: c.debugId ?? null,
      requestId: c.requestId ?? null,
      ms: Math.round(c.ms),
      error: c.error ?? null,
      respondedAt: sql`clock_timestamp()`,
    });
  };

  return { take, acquire, record, insertCompleted, state };
}

// ─── paypal-core's hooks over this limiter ───────────────────────────────────────────────────────────────

/** paypal-core's `LimiterRequest` (src/limiter.ts). */
export interface PayPalCoreLimiterRequest {
  purpose: string;
  priority: CallPriority;
}

/** paypal-core's `LimiterDecision`: `ticket` is the `paypal_calls` row this grant reserved. */
export type PayPalCoreLimiterDecision =
  | { ok: true; ticket?: string }
  | { ok: false; reason: DenyReason; retryAfterMs: number };

/** Structurally paypal-core's `PayPalLimiter`. */
export interface PayPalCoreLimiter {
  take(req: PayPalCoreLimiterRequest): Promise<PayPalCoreLimiterDecision>;
  /** The circuit is derived from the 429 row the recorder writes, so there is nothing to do here. */
  reportRateLimited(at: Date): Promise<void>;
}

/** paypal-core's `PayPalCallRecord` (src/recorder.ts): one HTTP attempt. */
export interface PayPalCoreCallRecord {
  at: Date;
  purpose: string;
  priority: CallPriority;
  method: string;
  path: string;
  /** 0 when PayPal sent no response (timeout, network error) */
  status: number;
  outcome: "ok" | "http_error" | "timeout" | "network_error";
  debugId: string | null;
  requestId: string | null;
  ms: number;
  attempt: number;
  ticket: string | null;
}

/** Structurally paypal-core's `PayPalCallRecorder`. */
export interface PayPalCoreCallRecorder {
  record(call: PayPalCoreCallRecord): Promise<void>;
}

/**
 * paypal-core's `PayPalLimiter` and `PayPalCallRecorder` on this limiter, for
 * `createPayPalCore({ limiter, recorder })`. Every attempt PayPalHttp makes takes a slot (its `paypal_calls` row is
 * the ticket) and the recorder completes that row: status (paypal-core's 0 for "no response" is stored as NULL with
 * the outcome as the error, so it never reads as an HTTP status), debug id, latency, method, path and request id.
 * A 429 recorded here opens the 6-minute circuit for every process. A call recorded without a ticket (made under some
 * other limiter) is inserted as a completed row, so it still counts in the window.
 */
export function paypalCoreLimiter(
  limiter: Limiter,
  opts: { workspaceId?: string | null } = {},
): { limiter: PayPalCoreLimiter; recorder: PayPalCoreCallRecorder } {
  return {
    limiter: {
      async take(req) {
        const r = await limiter.take({
          purpose: req.purpose,
          priority: req.priority,
          workspaceId: opts.workspaceId ?? null,
        });
        return r.ok ? { ok: true, ticket: r.callId } : r;
      },
      async reportRateLimited() {},
    },
    recorder: {
      async record(call) {
        const status = call.status > 0 ? call.status : null;
        const error = call.outcome === "ok" ? null : call.outcome;
        if (call.ticket) {
          await limiter.record(call.ticket, {
            status,
            debugId: call.debugId,
            ms: call.ms,
            error,
            method: call.method,
            path: call.path,
            requestId: call.requestId,
          });
          return;
        }
        await limiter.insertCompleted({
          at: call.at,
          purpose: call.purpose,
          priority: call.priority,
          workspaceId: opts.workspaceId ?? null,
          method: call.method,
          path: call.path,
          status,
          debugId: call.debugId,
          requestId: call.requestId,
          ms: call.ms,
          error,
        });
      },
    },
  };
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(String(v));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
