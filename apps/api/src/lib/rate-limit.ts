// In-process sliding-window throttles for request-level limits (fs-api runs one instance, register §6):
// presence at most 1 Hz per credential, pairing claims and judge session starts per hashed IP (S3.9).
// PayPal's budget is NOT here: that is the shared Postgres limiter (WS-DATA's `paypalCoreLimiter`, wired in
// server.ts).
import type { Clock } from "./clock.js";

export interface RateRule {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Single-key safety budget. Its live window must never be evicted. */
  readonly global?: true;
  /** Guess guard: dedicated storage; refuse rather than lose an in-window key. */
  readonly critical?: true;
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
  pairingClaim: { name: "pairingClaim", limit: 10, windowMs: 60_000, critical: true },
  /** Judge cookie: 3 session starts an hour. */
  judgeSessionPerCookie: { name: "judgeSessionPerCookie", limit: 3, windowMs: 3_600_000 },
  /** Hashed IP: 30 session starts an hour (a loose outer bound). */
  judgeSessionPerIp: { name: "judgeSessionPerIp", limit: 30, windowMs: 3_600_000 },
  judgeSessionGlobal: { name: "judgeSessionGlobal", limit: 60, windowMs: 60_000, global: true },
  /** Failed expensive admissions still count; personal/success budgets are refundable. Above the e2e crowd. */
  judgeSessionAttempts: { name: "judgeSessionAttempts", limit: 120, windowMs: 60_000, global: true },
  judgeSessionContendedAttempts: { name: "judgeSessionContendedAttempts", limit: 600, windowMs: 60_000 },
  judgeSessionPerNetworkDay: { name: "judgeSessionPerNetworkDay", limit: 60, windowMs: 86_400_000 },
} as const satisfies Record<string, RateRule>;

export const MAX_KEYS = 20_000;
/** Non-critical rules replace their own LRU at this partition cap. */
export const MAX_KEYS_PER_RULE = 10_000;
/** Reserved inside MAX_KEYS, so keyed pressure cannot prevent the first global reservation. */
export const MAX_GLOBAL_KEYS = 64;
export const CRITICAL_KEYS_PER_RULE = 2_000;
export const RESERVED_PER_RULE = 128;
const MAX_CRITICAL_KEYS = 4 * CRITICAL_KEYS_PER_RULE;
/** Shared non-critical keyed capacity. Critical quotas NEVER borrow from this pool (or vice versa). */
export const MAX_KEYED_KEYS = MAX_KEYS - MAX_GLOBAL_KEYS - MAX_CRITICAL_KEYS;
export const SWEEP_INTERVAL_MS = 5_000;

export function createKeyedRateLimiter(clock: Clock, hooks: { onSweep?: () => void } = {}): KeyedRateLimiter {
  type Window = { hits: number[]; windowMs: number; ruleName: string; global: boolean; critical: boolean };
  const windows = new Map<string, Window>();
  const partitions = new Map<string, Set<string>>();
  let globalKeys = 0;
  let criticalKeys = 0;
  let nextExpiry = Number.POSITIVE_INFINITY;
  function drop(id: string) {
    const value = windows.get(id);
    if (!value) return;
    windows.delete(id);
    if (value.global) globalKeys--;
    else if (value.critical) criticalKeys--;
    const partition = partitions.get(value.ruleName);
    partition?.delete(id);
    if (partition?.size === 0) partitions.delete(value.ruleName);
  }
  let lastSweep = clock.nowMs();
  const idOf = (rule: RateRule, key: string) => `${rule.name}\u0000${key}`;

  function sweep(now: number, forced = false) {
    if (forced ? now < nextExpiry : now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    hooks.onSweep?.();
    nextExpiry = Number.POSITIVE_INFINITY;
    for (const [k, value] of windows) {
      if (value.hits.length === 0 || (value.hits.at(-1) ?? 0) <= now - value.windowMs) drop(k);
      else nextExpiry = Math.min(nextExpiry, (value.hits.at(-1) ?? now) + value.windowMs);
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

  function globalsFit(pairs: readonly (readonly [RateRule, string])[]): boolean {
    const added = new Set<string>();
    const names = new Set<string>();
    for (const [rule, key] of pairs) {
      if (!rule.global || windows.has(idOf(rule, key)) || added.has(idOf(rule, key))) continue;
      // Global rules intentionally have exactly one key each.
      if (partitions.has(rule.name) || names.has(rule.name)) return false;
      added.add(idOf(rule, key));
      names.add(rule.name);
    }
    return globalKeys + added.size <= MAX_GLOBAL_KEYS;
  }

  type Pending = { rule: RateRule; key: string; hits: number[] };

  /** No hits, evictions or LRU changes until every pending rule has a storage plan. */
  function plan(pending: ReadonlyMap<string, Pending>, now: number) {
    sweep(now, true); // At pressure, reclaim expired entries even between periodic sweeps.
    const evictions = new Set<string>();
    const writes = new Set<string>();
    const sizes = new Map<string, number>();
    let shared = windows.size - globalKeys - criticalKeys;
    let critical = criticalKeys;
    const sizeOf = (name: string) => sizes.get(name) ?? partitions.get(name)?.size ?? 0;
    const victimOf = (name: string) => {
      for (const id of partitions.get(name) ?? []) {
        if (!pending.has(id) && !evictions.has(id)) return id;
      }
      return undefined;
    };
    for (const [id, { rule }] of pending) {
      if (windows.has(id) || rule.global) {
        writes.add(id);
        continue;
      }
      const size = sizeOf(rule.name);
      if (rule.critical) {
        if (size >= CRITICAL_KEYS_PER_RULE || critical >= MAX_CRITICAL_KEYS) {
          let expires = now + rule.windowMs;
          for (const key of partitions.get(rule.name) ?? []) {
            const value = windows.get(key);
            if (value) expires = Math.min(expires, (value.hits.at(-1) ?? now) + value.windowMs);
          }
          return { ok: false as const, retryAfterMs: Math.max(1_000, expires - now) };
        }
        critical++;
      } else {
        let victim: string | undefined;
        if (size >= MAX_KEYS_PER_RULE) victim = victimOf(rule.name);
        else if (shared >= MAX_KEYED_KEYS) {
          let largest = RESERVED_PER_RULE;
          for (const [name, partition] of partitions) {
            const first = partition.values().next().value;
            const value = first === undefined ? undefined : windows.get(first);
            if (!value || value.global || value.critical || sizeOf(name) <= largest) continue;
            const candidate = victimOf(name);
            if (candidate !== undefined) {
              largest = sizeOf(name);
              victim = candidate;
            }
          }
        }
        if (size >= MAX_KEYS_PER_RULE || shared >= MAX_KEYED_KEYS) {
          // Availability fallback is exclusively for non-critical rules, when every victim is protected.
          if (victim === undefined) continue;
          evictions.add(victim);
          const name = windows.get(victim)?.ruleName ?? rule.name;
          sizes.set(name, sizeOf(name) - 1);
          shared--;
        }
        shared++;
      }
      sizes.set(rule.name, sizeOf(rule.name) + 1);
      writes.add(id);
    }
    return { ok: true as const, evictions, writes };
  }

  function commit(rule: RateRule, key: string, hits: number[]) {
    const id = idOf(rule, key);
    if (!windows.has(id)) {
      if (rule.global) globalKeys++;
      else if (rule.critical) criticalKeys++;
    }
    const partition = partitions.get(rule.name) ?? new Set<string>();
    partition.delete(id);
    partition.add(id);
    partitions.set(rule.name, partition);
    windows.set(id, {
      hits,
      windowMs: rule.windowMs,
      ruleName: rule.name,
      global: rule.global === true,
      critical: rule.critical === true,
    });
    nextExpiry = Math.min(nextExpiry, (hits.at(-1) ?? 0) + rule.windowMs);
  }

  const limiter: KeyedRateLimiter = {
    take(rule, key) {
      const result = limiter.takeAll([[rule, key]]);
      return result.ok ? { ok: true, remaining: result.remaining } : result;
    },
    peek(rule, key) {
      const now = clock.nowMs();
      if (!globalsFit([[rule, key]])) return { ok: false, retryAfterMs: SWEEP_INTERVAL_MS };
      return decision(rule, hitsFor(rule, key, now), now);
    },
    takeAll(pairs) {
      const now = clock.nowMs();
      sweep(now);
      const pending = new Map<string, Pending>();
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
      if (!globalsFit(pairs)) return { ok: false, retryAfterMs: SWEEP_INTERVAL_MS };
      const planned = plan(pending, now);
      if (!planned.ok) return planned;
      for (const id of planned.evictions) drop(id);
      for (const [id, value] of pending) {
        if (planned.writes.has(id)) commit(value.rule, value.key, value.hits);
      }
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
      partitions.clear();
      globalKeys = 0;
      criticalKeys = 0;
      nextExpiry = Number.POSITIVE_INFINITY;
      lastSweep = clock.nowMs();
    },
    get size() {
      return windows.size;
    },
  };
  return limiter;
}
