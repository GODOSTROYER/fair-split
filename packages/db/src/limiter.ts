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
 */
import { sql } from "drizzle-orm";
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

export type DenyReason = "WINDOW_FULL" | "BACKGROUND_FULL" | "CIRCUIT_OPEN";

export type TakeResult =
  | { ok: true; callId: string; at: Date }
  | { ok: false; reason: DenyReason; retryAfterMs: number };

export interface CallOutcome {
  status: number | null;
  debugId?: string | null;
  ms: number;
  error?: string | null;
}

export interface LimiterState {
  inWindow: number;
  backgroundInWindow: number;
  circuitOpenUntil: Date | null;
  limits: LimiterConfig;
}

export interface Limiter {
  take(req: TakeRequest): Promise<TakeResult>;
  /** take, waiting out WINDOW_FULL/BACKGROUND_FULL denials up to maxWaitMs; CIRCUIT_OPEN returns at once */
  acquire(req: TakeRequest, opts?: { maxWaitMs?: number; signal?: AbortSignal }): Promise<TakeResult>;
  record(callId: string, outcome: CallOutcome): Promise<void>;
  state(): Promise<LimiterState>;
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

export function createLimiter(db: Db, config: Partial<LimiterConfig> = {}): Limiter {
  const cfg: LimiterConfig = { ...LIMITER_DEFAULTS, ...config };
  const windowSec = cfg.windowMs / 1000;
  const circuitSec = cfg.circuitMs / 1000;

  const readWindow = async (q: Pick<Db, "execute">): Promise<WindowRow> => {
    const res = await q.execute(sql`
      select clock_timestamp() as now,
             count(*) filter (where at > clock_timestamp() - make_interval(secs => ${windowSec})) as in_window,
             count(*) filter (where at > clock_timestamp() - make_interval(secs => ${windowSec})
                                and priority = 'background') as bg_in_window,
             min(at) filter (where at > clock_timestamp() - make_interval(secs => ${windowSec})) as oldest,
             min(at) filter (where at > clock_timestamp() - make_interval(secs => ${windowSec})
                               and priority = 'background') as oldest_bg,
             (select max(responded_at) from ${paypalCalls}
               where status = 429 and responded_at > clock_timestamp() - make_interval(secs => ${circuitSec})) as last_429
        from ${paypalCalls}
       where at > clock_timestamp() - make_interval(secs => ${Math.max(windowSec, 1)})`);
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
          reason: "BACKGROUND_FULL",
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
             error = ${o.error ?? null}, responded_at = clock_timestamp()
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

  return { take, acquire, record, state };
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
