// Per-client throttle modelled on the sandbox (50 requests a minute, then a 5-minute block).
import type { RateLimitOptions } from "../config.js";

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly blockedUntil = new Map<string, number>();

  constructor(
    private readonly opts: RateLimitOptions | false,
    private readonly now: () => number,
  ) {}

  check(key: string): RateDecision {
    if (!this.opts) return { allowed: true };
    const t = this.now();
    const until = this.blockedUntil.get(key);
    if (until !== undefined) {
      if (t < until) return { allowed: false, retryAfterSeconds: Math.ceil((until - t) / 1000) };
      this.blockedUntil.delete(key);
      this.hits.delete(key);
    }
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - 60_000);
    if (recent.length >= this.opts.perMinute) {
      this.blockedUntil.set(key, t + this.opts.blockSeconds * 1000);
      this.hits.delete(key);
      return { allowed: false, retryAfterSeconds: this.opts.blockSeconds };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  clear(): void {
    this.hits.clear();
    this.blockedUntil.clear();
  }
}
