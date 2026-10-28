// In-process sliding-window throttles for request-level limits (fs-api runs one instance, register §6):
// presence at most 1 Hz per credential, pairing claims and judge session starts per hashed IP (S3.9).
// PayPal's budget is NOT here: that is the shared Postgres limiter (WS-DATA's `paypalCoreLimiter`, wired in
// server.ts).
import type { Clock } from "./clock.js";

export interface RateRule {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

export interface KeyedRateLimiter {
  /** Take one slot for `key` under `rule`. */
  take(rule: RateRule, key: string): RateDecision;
  /** Forget every window (tests, judge reset). */
  reset(): void;
  readonly size: number;
}

/** Register limits (S3.7 presence, S3.9 quotas). Slices may define more; keep them here so /ops can list them. */
export const RATE_RULES = {
  /** POST /v1/presence: at most 1 Hz per client. */
  presence: { name: "presence", limit: 1, windowMs: 1_000 },
  /** POST /v1/pairing/claim: guessing a 6-digit code must be slow (per hashed IP). */
  pairingClaim: { name: "pairingClaim", limit: 10, windowMs: 60_000 },
  /** Judge cookie: 3 session starts an hour. */
  judgeSessionPerCookie: { name: "judgeSessionPerCookie", limit: 3, windowMs: 3_600_000 },
  /** Hashed IP: 30 session starts an hour (a loose outer bound). */
  judgeSessionPerIp: { name: "judgeSessionPerIp", limit: 30, windowMs: 3_600_000 },
} as const satisfies Record<string, RateRule>;

const MAX_KEYS = 20_000;

export function createKeyedRateLimiter(clock: Clock): KeyedRateLimiter {
  const windows = new Map<string, number[]>();

  function sweep(now: number) {
    for (const [k, hits] of windows) {
      if (hits.length === 0 || (hits[hits.length - 1] ?? 0) <= now - 3_600_000) windows.delete(k);
    }
  }

  return {
    take(rule, key) {
      const now = clock.nowMs();
      const id = `${rule.name}\u0000${key}`;
      let hits = windows.get(id);
      if (!hits) {
        if (windows.size >= MAX_KEYS) sweep(now);
        hits = [];
        windows.set(id, hits);
      }
      while (hits.length > 0 && (hits[0] ?? 0) <= now - rule.windowMs) hits.shift();
      if (hits.length >= rule.limit) {
        return { ok: false, retryAfterMs: Math.max(1, (hits[0] ?? now) + rule.windowMs - now) };
      }
      hits.push(now);
      return { ok: true, remaining: rule.limit - hits.length };
    },
    reset() {
      windows.clear();
    },
    get size() {
      return windows.size;
    },
  };
}
