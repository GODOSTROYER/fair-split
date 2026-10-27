// Per-address throttle modelled on the sandbox: 50 requests a minute per IP, then a 5-minute block.
// The map of addresses is capped, so a caller rotating addresses cannot grow it without bound.
import type { RateLimitOptions } from "../config.js";

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly blockedUntil = new Map<string, number>();

  constructor(
    private readonly opts: RateLimitOptions | false,
    private readonly now: () => number,
  ) {}

  private get maxKeys(): number {
    return this.opts ? Math.max(1, this.opts.maxKeys ?? DEFAULT_MAX_KEYS) : DEFAULT_MAX_KEYS;
  }

  check(key: string): RateDecision {
    if (!this.opts) return { allowed: true };
    const t = this.now();
    const until = this.blockedUntil.get(key);
    if (until !== undefined) {
      if (t < until) return { allowed: false, retryAfterSeconds: Math.ceil((until - t) / 1000) };
      this.blockedUntil.delete(key);
      this.hits.delete(key);
    }
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - WINDOW_MS);
    this.hits.delete(key);
    if (recent.length >= this.opts.perMinute) {
      this.blockedUntil.set(key, t + this.opts.blockSeconds * 1000);
      this.trim(t);
      return { allowed: false, retryAfterSeconds: this.opts.blockSeconds };
    }
    recent.push(t);
    this.hits.set(key, recent); // re-inserted last: the map's order is least recently seen first
    this.trim(t);
    return { allowed: true };
  }

  /** Addresses currently tracked (counting and blocked). */
  get size(): number {
    return this.hits.size + this.blockedUntil.size;
  }

  /** Keeps both maps under maxKeys: expired entries go first, then the least recently seen. */
  private trim(t: number): void {
    const max = this.maxKeys;
    if (this.hits.size > max) {
      for (const [k, v] of this.hits) if (v.every((x) => x <= t - WINDOW_MS)) this.hits.delete(k);
      const target = Math.floor(max * 0.9);
      for (const k of this.hits.keys()) {
        if (this.hits.size <= target) break;
        this.hits.delete(k);
      }
    }
    if (this.blockedUntil.size > max) {
      for (const [k, until] of this.blockedUntil) if (until <= t) this.blockedUntil.delete(k);
      const target = Math.floor(max * 0.9);
      for (const k of this.blockedUntil.keys()) {
        if (this.blockedUntil.size <= target) break;
        this.blockedUntil.delete(k);
      }
    }
  }

  clear(): void {
    this.hits.clear();
    this.blockedUntil.clear();
  }
}
