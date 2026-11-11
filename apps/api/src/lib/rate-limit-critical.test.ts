import { expect, it } from "vitest";
import { JUDGE_RATE_RULES } from "../judge/runtime.js";
import { PROOF_RATE_RULES } from "../proof/limits.js";
import { createFakeClock } from "./clock.js";
import { createKeyedRateLimiter, RATE_RULES, type RateRule } from "./rate-limit.js";

it("critical capacity refuses atomically without spending or evicting another rule", () => {
  const clock = createFakeClock();
  const l = createKeyedRateLimiter(clock);
  for (let i = 0; i < 2_000; i++) l.take(JUDGE_RATE_RULES.opsLoginPerIp, `net:${i}`);
  const pairs = [
    [PROOF_RATE_RULES.publicRead, "honest"],
    [JUDGE_RATE_RULES.opsLoginGlobal, "all"],
    [JUDGE_RATE_RULES.opsLoginPerIp, "overflow"],
  ] as const;
  expect(l.take(JUDGE_RATE_RULES.opsLoginPerIp, "overflow")).toEqual({ ok: false, retryAfterMs: 60_000 });
  expect(l.takeAll(pairs)).toEqual({ ok: false, retryAfterMs: 60_000 });
  expect(l.size).toBe(2_000);
  expect(l.peek(PROOF_RATE_RULES.publicRead, "honest")).toEqual({ ok: true, remaining: 120 });
  expect(l.peek(JUDGE_RATE_RULES.opsLoginGlobal, "all")).toEqual({ ok: true, remaining: 300 });
  clock.advance(59_500);
  expect(l.takeAll(pairs)).toEqual({ ok: false, retryAfterMs: 1_000 });
  clock.advance(500);
  expect(l.takeAll(pairs).ok).toBe(true);
});

it("a multi-key critical reservation accounts for all planned keys before committing", () => {
  const l = createKeyedRateLimiter(createFakeClock());
  for (let i = 0; i < 1_999; i++) l.take(JUDGE_RATE_RULES.opsLoginPerIp, `net:${i}`);
  expect(
    l.takeAll([
      [JUDGE_RATE_RULES.opsLoginPerIp, "A"],
      [JUDGE_RATE_RULES.opsLoginPerIp, "B"],
    ]).ok,
  ).toBe(false);
  expect(l.size).toBe(1_999);
  expect(l.peek(JUDGE_RATE_RULES.opsLoginPerIp, "A")).toEqual({ ok: true, remaining: 5 });
});

it("all four guess guards explicitly opt into critical storage", () => {
  const rules: RateRule[] = [...Object.values(RATE_RULES), ...Object.values(JUDGE_RATE_RULES)];
  expect(
    rules
      .filter((rule) => "critical" in rule && rule.critical)
      .map((rule) => rule.name)
      .sort(),
  ).toEqual(["judgeCodePerIp", "judgeCodePerSession", "opsLoginPerIp", "pairingClaim"]);
});
