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
export type ReservedRateDecision =
  | { ok: true; remaining: number; takenAtMs: number }
  | { ok: false; retryAfterMs: number };

export interface KeyedRateLimiter {
  /** Take one slot for `key` under `rule`. */
  take(rule: RateRule, key: string): RateDecision;
  /** Atomically consume all pairs, or consume none. Duplicate pairs count as separate slots. */
  takeAll(pairs: readonly (readonly [RateRule, string])[]): ReservedRateDecision;
  /** Check without consuming or creating a key. */
  peek(rule: RateRule, key: string): RateDecision;
  /** Return a failed reservation's slot; its exact time protects newer slots after long failures. */
  refund(rule: RateRule, key: string, takenAtMs?: number): void;
  /** Forget every window (tests, judge reset). */
  reset(): void;
  readonly size: number;
}

/** Register limits (S3.7 presence, S3.9 quotas). Slices may define more; keep them here so /ops can list them. */
export const RATE_RULES = {
  sseOpen: { name: "sseOpen", limit: 30, windowMs: 60_000 },
  /** POST /v1/presence: at most 1 Hz per client. */
  presence: { name: "presence", limit: 1, windowMs: 1_000 },
  /** POST /v1/pairing/claim: guessing a 6-digit code must be slow (per hashed IP). */
  pairingClaim: { name: "pairingClaim", limit: 10, windowMs: 60_000 },
  /** Judge cookie: 3 session starts an hour. */
  judgeSessionPerCookie: { name: "judgeSessionPerCookie", limit: 3, windowMs: 3_600_000 },
  /** Hashed IP: 30 session starts an hour (a loose outer bound). */
  judgeSessionPerIp: { name: "judgeSessionPerIp", limit: 30, windowMs: 3_600_000 },
  judgeSessionGlobal: { name: "judgeSessionGlobal", limit: 60, windowMs: 60_000 },
  /** Failed expensive admissions still count; personal/success budgets are refundable. Above the e2e crowd. */
  judgeSessionAttempts: { name: "judgeSessionAttempts", limit: 120, windowMs: 60_000 },
  judgeSessionPerNetworkDay: { name: "judgeSessionPerNetworkDay", limit: 60, windowMs: 86_400_000 },
} as const satisfies Record<string, RateRule>;

export const MAX_KEYS = 20_000;
/** One noisy route cannot occupy the entire limiter. Live windows never get evicted. */
export const MAX_KEYS_PER_RULE = 1_000;
export const SWEEP_INTERVAL_MS = 5_000;

export function createKeyedRateLimiter(clock: Clock, hooks: { onSweep?: () => void } = {}): KeyedRateLimiter {
  const windows = new Map<string, { hits: number[]; windowMs: number; ruleName: string }>();
  const counts = new Map<string, number>();
  function drop(id: string) {
    const value = windows.get(id);
    if (!value) return;
    windows.delete(id);
    const count = (counts.get(value.ruleName) ?? 1) - 1;
    if (count === 0) counts.delete(value.ruleName);
    else counts.set(value.ruleName, count);
  }
  let lastSweep = clock.nowMs();
  const idOf = (rule: RateRule, key: string) => `${rule.name}\u0000${key}`;

  function sweep(now: number) {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    hooks.onSweep?.();
    for (const [k, value] of windows) {
      if (value.hits.length === 0 || (value.hits.at(-1) ?? 0) <= now - value.windowMs) drop(k);
    }
  }

  function hitsFor(rule: RateRule, key: string, now: number): number[] {
    const hits = windows.get(idOf(rule, key))?.hits ?? [];
    while (hits.length > 0 && (hits[0] ?? 0) <= now - rule.windowMs) hits.shift();
    return hits;
  }

  function decision(rule: RateRule, hits: number[], now: number): RateDecision {
    return hits.length >= rule.limit
      ? { ok: false, retryAfterMs: Math.max(1, (hits[0] ?? now) + rule.windowMs - now) }
      : { ok: true, remaining: rule.limit - hits.length };
  }

  function hasCapacity(pairs: readonly (readonly [RateRule, string])[], now: number): boolean {
    const fits = () => {
      const added = new Map<string, number>();
      const ids = new Set<string>();
      for (const [rule, key] of pairs) {
        const id = idOf(rule, key);
        if (windows.has(id) || ids.has(id)) continue;
        ids.add(id);
        added.set(rule.name, (added.get(rule.name) ?? 0) + 1);
      }
      return (
        windows.size + ids.size <= MAX_KEYS &&
        [...added].every(([name, count]) => (counts.get(name) ?? 0) + count <= MAX_KEYS_PER_RULE)
      );
    };
    if (fits()) return true;
    sweep(now);
    return fits();
  }

  function touch(rule: RateRule, key: string, hits: number[]) {
    const id = idOf(rule, key);
    if (!windows.has(id)) counts.set(rule.name, (counts.get(rule.name) ?? 0) + 1);
    windows.set(id, { hits, windowMs: rule.windowMs, ruleName: rule.name });
  }

  const limiter: KeyedRateLimiter = {
    take(rule, key) {
      const now = clock.nowMs();
      if (!hasCapacity([[rule, key]], now)) return { ok: false, retryAfterMs: SWEEP_INTERVAL_MS };
      const hits = hitsFor(rule, key, now);
      const result = decision(rule, hits, now);
      if (result.ok) hits.push(now);
      touch(rule, key, hits);
      return result.ok ? { ok: true, remaining: rule.limit - hits.length } : result;
    },
    peek(rule, key) {
      const now = clock.nowMs();
      if (!hasCapacity([[rule, key]], now)) return { ok: false, retryAfterMs: SWEEP_INTERVAL_MS };
      return decision(rule, hitsFor(rule, key, now), now);
    },
    takeAll(pairs) {
      const now = clock.nowMs();
      const pending = new Map<string, { rule: RateRule; key: string; hits: number[] }>();
      let remaining = Number.POSITIVE_INFINITY;
      for (const [rule, key] of pairs) {
        const id = idOf(rule, key);
        let value = pending.get(id);
        if (!value) {
          value = { rule, key, hits: [...hitsFor(rule, key, now)] };
          pending.set(id, value);
        }
        const result = decision(rule, value.hits, now);
        if (!result.ok) return result;
        value.hits.push(now);
        remaining = Math.min(remaining, rule.limit - value.hits.length);
      }
      if (!hasCapacity(pairs, now)) return { ok: false, retryAfterMs: SWEEP_INTERVAL_MS };
      for (const value of pending.values()) touch(value.rule, value.key, value.hits);
      return { ok: true, remaining, takenAtMs: now };
    },
    refund(rule, key, takenAtMs) {
      const hits = hitsFor(rule, key, clock.nowMs());
      if (takenAtMs === undefined) hits.pop();
      else {
        const at = hits.lastIndexOf(takenAtMs);
        if (at >= 0) hits.splice(at, 1);
      }
      if (hits.length === 0) drop(idOf(rule, key));
    },
    reset() {
      windows.clear();
      counts.clear();
      lastSweep = clock.nowMs();
    },
    get size() {
      return windows.size;
    },
  };
  return limiter;
}
