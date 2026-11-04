import { describe, expect, it } from "vitest";
import { quotaHourDelay } from "./quota-clock.js";

describe("quota fixture clock-hour guard", () => {
  it("leaves a full three-minute window for a payout before quota rows expire", () => {
    expect(quotaHourDelay(Date.parse("2026-11-01T09:56:59.999Z"))).toBe(0);
    expect(quotaHourDelay(Date.parse("2026-11-01T09:57:00.000Z"))).toBe(181_000);
    expect(quotaHourDelay(Date.parse("2026-11-01T09:59:59.999Z"))).toBe(1_001);
    expect(quotaHourDelay(Date.parse("2026-11-01T10:00:00.000Z"))).toBe(0);
  });
});
