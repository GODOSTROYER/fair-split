// The limiter hook PayPalHttp calls before every PayPal request (architecture §6.1, S3.6.2).
//
// Production uses WS-DATA's Postgres limiter (`limiter.take` under pg_advisory_xact_lock, counting
// `paypal_calls` over the last 60 s across all services). It is injected; this package only defines
// the interface and an in-memory reference implementation with the same rules, used by tools,
// local runs and tests:
//   - at most 40 calls in any 60 s window, across all priorities;
//   - at most 20 of them at background priority, so live judges keep at least 20;
//   - a 429 from PayPal opens a 6-minute circuit (longer than the sandbox's 5-minute block).

import type { CallPriority, CallPurpose } from "./types.js";

export const LIMITER_DEFAULTS = Object.freeze({
  perMinute: 40,
  backgroundPerMinute: 20,
  windowMs: 60_000,
  circuitMs: 6 * 60_000,
});

export interface LimiterRequest {
  purpose: CallPurpose;
  priority: CallPriority;
}

export type LimiterDenyReason = "WINDOW_FULL" | "BACKGROUND_SHARE_FULL" | "CIRCUIT_OPEN";

export type LimiterDecision =
  /** `ticket` lets a Postgres limiter hand back the `paypal_calls` row it reserved; it is echoed to the recorder. */
  { ok: true; ticket?: string } | { ok: false; reason: LimiterDenyReason; retryAfterMs: number };

export interface PayPalLimiter {
  take(req: LimiterRequest): Promise<LimiterDecision>;
  /**
   * PayPal answered 429. The in-memory limiter opens its circuit here; the Postgres limiter can
   * ignore it because it derives the circuit from the 429 row the recorder writes.
   */
  reportRateLimited?(at: Date): void | Promise<void>;
}

export interface LimiterSnapshot {
  inWindow: number;
  backgroundInWindow: number;
  circuitOpenUntil: number | null;
  perMinute: number;
  backgroundPerMinute: number;
}

export interface MemoryLimiterOptions {
  perMinute?: number;
  backgroundPerMinute?: number;
  windowMs?: number;
  circuitMs?: number;
  now?: () => number;
}

export interface MemoryLimiter extends PayPalLimiter {
  reportRateLimited(at: Date): void;
  /** For the /ops gauge: calls in the window against 40 and 20, and the circuit. */
  snapshot(): LimiterSnapshot;
}

/** In-process sliding-window limiter with the register's rules. Single-threaded, so `take` is atomic. */
export function createMemoryLimiter(options: MemoryLimiterOptions = {}): MemoryLimiter {
  const perMinute = options.perMinute ?? LIMITER_DEFAULTS.perMinute;
  const backgroundPerMinute = options.backgroundPerMinute ?? LIMITER_DEFAULTS.backgroundPerMinute;
  const windowMs = options.windowMs ?? LIMITER_DEFAULTS.windowMs;
  const circuitMs = options.circuitMs ?? LIMITER_DEFAULTS.circuitMs;
  const now = options.now ?? Date.now;
  const calls: { at: number; priority: CallPriority }[] = [];
  let circuitUntil = 0;

  const prune = (t: number) => {
    while (calls.length > 0 && (calls[0]?.at ?? t) <= t - windowMs) calls.shift();
  };

  return {
    async take(req) {
      const t = now();
      prune(t);
      if (t < circuitUntil) return { ok: false, reason: "CIRCUIT_OPEN", retryAfterMs: circuitUntil - t };
      if (calls.length >= perMinute) {
        const oldest = calls[0]?.at ?? t;
        return { ok: false, reason: "WINDOW_FULL", retryAfterMs: Math.max(1, oldest + windowMs - t) };
      }
      if (req.priority === "background") {
        const background = calls.filter((c) => c.priority === "background");
        if (background.length >= backgroundPerMinute) {
          const oldest = background[0]?.at ?? t;
          return {
            ok: false,
            reason: "BACKGROUND_SHARE_FULL",
            retryAfterMs: Math.max(1, oldest + windowMs - t),
          };
        }
      }
      calls.push({ at: t, priority: req.priority });
      return { ok: true };
    },
    reportRateLimited(at) {
      circuitUntil = Math.max(circuitUntil, at.getTime() + circuitMs);
    },
    snapshot() {
      const t = now();
      prune(t);
      return {
        inWindow: calls.length,
        backgroundInWindow: calls.filter((c) => c.priority === "background").length,
        circuitOpenUntil: t < circuitUntil ? circuitUntil : null,
        perMinute,
        backgroundPerMinute,
      };
    },
  };
}

/** A limiter that always allows. For unit tests of code that is not about rate limits. */
export const unlimitedLimiter: PayPalLimiter = Object.freeze({
  take: async (): Promise<LimiterDecision> => ({ ok: true }),
});
