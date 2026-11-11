import { describe, expect, it } from "vitest";
import { createFakeClock } from "./clock.js";
import { createKeyedRateLimiter, MAX_KEYED_KEYS, MAX_KEYS_PER_RULE, RATE_RULES } from "./rate-limit.js";

const rule = { name: "flood", limit: 200_000, windowMs: 3_600_000 };

describe("HD6-2 bounded sliding windows", () => {
  it("100k keys stay bounded and a frequently touched key retains its window", () => {
    const clock = createFakeClock();
    const limiter = createKeyedRateLimiter(clock);
    for (let i = 0; i < 100_000; i++) {
      limiter.take(rule, String(i));
      if (i % 1_000 === 0) limiter.take(rule, "active");
      clock.advance(1);
      if (i === 20_000) expect(limiter.size).toBeLessThanOrEqual(20_000);
    }
    expect(limiter.size).toBeLessThanOrEqual(20_000);
    expect(limiter.take(rule, "active")).toEqual({ ok: true, remaining: rule.limit - 101 });
  });

  it("sweeps each rule's own idle window at most once per sweep interval", () => {
    const clock = createFakeClock();
    let sweeps = 0;
    const limiter = createKeyedRateLimiter(clock, { onSweep: () => sweeps++ });
    limiter.take(rule, "oldest");
    limiter.take({ name: "short", limit: 1, windowMs: 1_000 }, "short");
    for (let i = 0; i < MAX_KEYED_KEYS - 2; i++) {
      limiter.take({ ...rule, name: `flood:${Math.floor(i / 999)}` }, String(i));
    }
    clock.advance(5_001);
    expect(limiter.take(rule, "pressure").ok).toBe(true);
    expect(limiter.size).toBe(MAX_KEYED_KEYS);
    expect(limiter.peek(rule, "oldest")).toEqual({ ok: true, remaining: rule.limit - 1 });
    limiter.refund(rule, "pressure");
    expect(limiter.peek({ name: "short", limit: 1, windowMs: 1_000 }, "short")).toEqual({
      ok: true,
      remaining: 1,
    });
    for (let i = 0; i < 1_000; i++) limiter.take(rule, `more:${i}`);
    expect(sweeps).toBe(1);
  });

  it("unrelated rule churn never drops global or network admission windows", () => {
    const limiter = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < RATE_RULES.judgeSessionGlobal.limit; i++) {
      limiter.take(RATE_RULES.judgeSessionGlobal, "all");
    }
    limiter.take(RATE_RULES.judgeSessionPerIp, "network");
    for (let i = 0; i < 25_000; i++) limiter.take(rule, `flood:${i}`);
    expect(limiter.take(RATE_RULES.judgeSessionGlobal, "all").ok).toBe(false);
    expect(limiter.peek(RATE_RULES.judgeSessionPerIp, "network")).toEqual({
      ok: true,
      remaining: RATE_RULES.judgeSessionPerIp.limit - 1,
    });
    expect(limiter.size).toBeLessThanOrEqual(20_000);
  });

  it("full keyed partitions admit new identities without waiving atomic global refusals", () => {
    const limiter = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < MAX_KEYS_PER_RULE; i++) {
      expect(limiter.take(RATE_RULES.judgeSessionPerIp, `network:${i}`).ok).toBe(true);
    }
    for (let i = 0; i < RATE_RULES.judgeSessionGlobal.limit; i++) {
      limiter.take(RATE_RULES.judgeSessionGlobal, "all");
    }
    const before = limiter.size;
    expect(limiter.peek(RATE_RULES.judgeSessionPerIp, "another-network").ok).toBe(true);
    expect(
      limiter.takeAll([
        [RATE_RULES.judgeSessionGlobal, "all"],
        [RATE_RULES.judgeSessionPerIp, "another-network"],
      ]).ok,
    ).toBe(false);
    expect(limiter.size).toBe(before);
    expect(limiter.peek(RATE_RULES.judgeSessionGlobal, "all")).toEqual({
      ok: false,
      retryAfterMs: RATE_RULES.judgeSessionGlobal.windowMs,
    });
    expect(limiter.peek(RATE_RULES.judgeSessionPerIp, "network:0")).toEqual({
      ok: true,
      remaining: RATE_RULES.judgeSessionPerIp.limit - 1,
    });
    expect(limiter.take(RATE_RULES.judgeSessionPerIp, "another-network").ok).toBe(true);
    expect(limiter.size).toBe(before);
  });

  it("takeAll spends nothing when the last rule refuses; peek and refund do not invent slots", () => {
    const clock = createFakeClock();
    const limiter = createKeyedRateLimiter(clock);
    const one = { name: "one", limit: 1, windowMs: 1_000 };
    limiter.take(one, "full");
    expect(
      limiter.takeAll([
        [one, "fresh"],
        [one, "full"],
      ]).ok,
    ).toBe(false);
    expect(limiter.peek(one, "fresh")).toEqual({ ok: true, remaining: 1 });
    expect(limiter.size).toBe(1);
    expect(limiter.take(one, "fresh").ok).toBe(true);
    limiter.refund(one, "fresh");
    expect(limiter.peek(one, "fresh")).toEqual({ ok: true, remaining: 1 });
    expect(
      limiter.takeAll([
        [one, "duplicate"],
        [one, "duplicate"],
      ]).ok,
    ).toBe(false);
    expect(limiter.peek(one, "duplicate").ok).toBe(true);
  });

  it("HD6-13: refunding an expired reservation cannot remove a newer successful slot", () => {
    const clock = createFakeClock();
    const limiter = createKeyedRateLimiter(clock);
    const one = { name: "reservation", limit: 1, windowMs: 1_000 };
    const reservedAt = clock.nowMs();
    limiter.take(one, "all");
    clock.advance(1_001);
    expect(limiter.take(one, "all").ok).toBe(true);
    limiter.refund(one, "all", reservedAt);
    expect(limiter.peek(one, "all").ok).toBe(false);
  });

  it("HD6-13: refunding an older in-window reservation preserves the newer slot's expiry", () => {
    const clock = createFakeClock();
    const limiter = createKeyedRateLimiter(clock);
    const two = { name: "reservation", limit: 2, windowMs: 1_000 };
    const reservedAt = clock.nowMs();
    limiter.take(two, "all");
    clock.advance(500);
    limiter.take(two, "all");
    limiter.refund(two, "all", reservedAt);
    clock.advance(501);
    expect(limiter.peek(two, "all")).toEqual({ ok: true, remaining: 1 });
  });
});
