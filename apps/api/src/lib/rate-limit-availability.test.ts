import { expect, it } from "vitest";
import { JUDGE_RATE_RULES } from "../judge/runtime.js";
import { createFakeClock } from "./clock.js";
import { LINK_READ_RULES } from "./link-read.js";
import {
  createKeyedRateLimiter,
  MAX_GLOBAL_KEYS,
  MAX_KEYED_KEYS,
  MAX_KEYS,
  MAX_KEYS_PER_RULE,
  RATE_RULES,
} from "./rate-limit.js";

it.each([LINK_READ_RULES.link, JUDGE_RATE_RULES.resume])(
  "HD6 R1: a full $name partition admits an honest caller and preserves global windows",
  (rule) => {
    const limiter = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < RATE_RULES.judgeSessionGlobal.limit; i++) {
      expect(limiter.take(RATE_RULES.judgeSessionGlobal, "all").ok).toBe(true);
    }
    for (let i = 0; i < MAX_KEYS_PER_RULE; i++) {
      expect(limiter.take(rule, `attacker:${i}`).ok).toBe(true);
    }
    const size = limiter.size;
    expect(limiter.peek(rule, "honest").ok).toBe(true);
    expect(limiter.size).toBe(size);
    expect(
      limiter.takeAll([
        [rule, "honest"],
        [LINK_READ_RULES.network, "classroom"],
      ]).ok,
    ).toBe(true);
    expect(limiter.peek(rule, "honest")).toEqual({ ok: true, remaining: rule.limit - 1 });
    expect(limiter.peek(rule, `attacker:${MAX_KEYS_PER_RULE - 1}`)).toEqual({
      ok: true,
      remaining: rule.limit - 1,
    });
    expect(limiter.take(RATE_RULES.judgeSessionGlobal, "all").ok).toBe(false);
    expect(limiter.size).toBeLessThanOrEqual(MAX_KEYS);
  },
);

it("HD6 R1: total keyed pressure leaves room for global rules and new routes", () => {
  const limiter = createKeyedRateLimiter(createFakeClock());
  for (const rule of [LINK_READ_RULES.link, JUDGE_RATE_RULES.resume, RATE_RULES.judgeSessionPerIp]) {
    for (let i = 0; i < MAX_KEYS_PER_RULE; i++) limiter.take(rule, `attacker:${i}`);
  }
  expect(limiter.size).toBe(MAX_KEYED_KEYS);
  expect(
    limiter.takeAll([
      [RATE_RULES.judgeSessionGlobal, "all"],
      [JUDGE_RATE_RULES.publicLane, "honest"],
    ]).ok,
  ).toBe(true);
  expect(limiter.peek(RATE_RULES.judgeSessionGlobal, "all")).toEqual({
    ok: true,
    remaining: RATE_RULES.judgeSessionGlobal.limit - 1,
  });
  expect(limiter.peek(LINK_READ_RULES.link, "attacker:0")).toEqual({
    ok: true,
    remaining: LINK_READ_RULES.link.limit,
  });
  expect(limiter.size).toBeLessThanOrEqual(MAX_KEYS);
});

it("HD6 R1: a full global partition refuses atomically without evicting keyed windows", () => {
  const limiter = createKeyedRateLimiter(createFakeClock());
  for (let i = 0; i < MAX_GLOBAL_KEYS; i++) {
    expect(limiter.take({ name: `global:${i}`, limit: 1, windowMs: 60_000, global: true }, "all").ok).toBe(
      true,
    );
  }
  for (let i = 0; i < MAX_KEYS_PER_RULE; i++) limiter.take(LINK_READ_RULES.link, `link:${i}`);
  expect(
    limiter.takeAll([
      [LINK_READ_RULES.link, "honest"],
      [RATE_RULES.judgeSessionGlobal, "all"],
    ]).ok,
  ).toBe(false);
  expect(limiter.peek(LINK_READ_RULES.link, "link:0")).toEqual({
    ok: true,
    remaining: LINK_READ_RULES.link.limit - 1,
  });
  expect(limiter.peek(LINK_READ_RULES.link, "honest")).toEqual({
    ok: true,
    remaining: LINK_READ_RULES.link.limit,
  });
  expect(limiter.take({ name: "global:0", limit: 1, windowMs: 60_000, global: true }, "all").ok).toBe(false);
});
