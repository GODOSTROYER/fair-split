import { describe, expect, it } from "vitest";
import { cashDayIso, resolvedHolds } from "../_shims/seed";
import { buildDemoStatement } from "../services/demo-fixtures";
import { dayGap, followingDay, seasonLabel } from "./display";
import { hatchLines, MARK_KIND, MICRO_WORD, ringDash, TAG_BUDGET } from "./honesty";

describe("UI gate round 3 on the phone: one truth for ids and dates", () => {
  it("shows the season as 2026-A whatever the source spells", () => {
    expect(seasonLabel("2026A")).toBe("2026-A");
    expect(seasonLabel("2026-A")).toBe("2026-A");
    expect(seasonLabel(" 2026a ")).toBe("2026-A");
    expect(seasonLabel("2026A-r1")).toBe("2026A-r1");
    expect(seasonLabel("")).toBe("");
  });

  it("counts the seed's gap from the holds to the bodega's day in Calinan days", () => {
    expect(dayGap(resolvedHolds.at(-1)?.resolvedAt ?? "", cashDayIso)).toBe(1);
    expect(dayGap("2026-11-05T23:30:00+08:00", "2026-11-06T00:30:00+08:00")).toBe(1);
    expect(dayGap("nope", cashDayIso)).toBe(0);
  });

  it("dates the day after today in Calinan, at the seed's hour", () => {
    // 5 Nov 23:30 in Calinan is 15:30 UTC: the next day there is 6 Nov.
    expect(followingDay("2026-11-05T15:30:00Z", 1)).toBe("2026-11-06T08:00:00+08:00");
    // 5 Nov 17:00 UTC is already 6 Nov 01:00 in Calinan.
    expect(followingDay("2026-11-05T17:00:00Z", 1)).toBe("2026-11-07T08:00:00+08:00");
    expect(followingDay("not a date", 1)).toBe("not a date");
  });

  it("never dates the demo's expected pay before the run it shows (the date follows the clock)", () => {
    const now = "2026-11-05T05:45:00Z";
    const dto = buildDemoStatement({ stage: "checking", now });
    expect(dto.expectedDate).toBe("2026-11-06T08:00:00+08:00");
    expect(Date.parse(dto.expectedDate ?? "")).toBeGreaterThan(Date.parse(now));
    // The bodega's own day stays the seed's (the clerk's demo keeps it: cash-day.test).
    expect(dto.cashDay).toBe(cashDayIso);
    for (const stage of ["sent", "paid", "cash-due"] as const) {
      expect(buildDemoStatement({ stage, now }).expectedDate).toBeNull();
    }
  });
});

describe("UI gate round 3 on the phone: honesty marks with a budget", () => {
  it("turns each old pill into the console's glyph kinds", () => {
    expect(MARK_KIND.demoData).toBe("synthetic");
    expect(MARK_KIND.syntheticSample).toBe("synthetic");
    expect(MARK_KIND.syntheticVoice).toBe("synthetic");
    expect(MARK_KIND.machineTranslated).toBe("simulated");
    expect(MARK_KIND.demoKey).toBe("simulated");
    expect(MARK_KIND.simulatedPush).toBe("simulated");
    expect(MARK_KIND.realCode).toBe("real");
  });

  it("keeps the micro-tag's one word and the console's budget", () => {
    expect(MICRO_WORD).toBe("Sandbox");
    expect(TAG_BUDGET).toEqual({ perScreen: 3, microPerScreen: 2 });
  });

  it("cuts every hatch stroke to its square and draws a visible dash", () => {
    const lines = hatchLines(1.5, 10.5);
    expect(lines).toHaveLength(6);
    for (const l of lines) {
      for (const v of [l.x1, l.y1, l.x2, l.y2]) {
        expect(v).toBeGreaterThanOrEqual(1.5 - 1e-9);
        expect(v).toBeLessThanOrEqual(10.5 + 1e-9);
      }
    }
    const [dash, gap] = ringDash(12);
    expect(dash).toBeGreaterThan(gap);
    expect(ringDash(4)[0]).toBe(1.4);
  });
});
