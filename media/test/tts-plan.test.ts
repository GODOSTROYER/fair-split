import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { s10Verdict } from "../src/tts/cli.js";
import { APPROVED_STATEMENT_REQUESTS, daysNeeded, requestPlan } from "../src/tts/plan.js";
import { QuotaExceededError, QuotaLedger, SELF_IMPOSED_DAILY_CAP } from "../src/tts/quota.js";
import { MEDIA_ROOT } from "../src/util/env.js";

describe("S10 request plan: how many TTS requests, and how many days they take", () => {
  it("counts the approved plan's statements: M-014 in three languages, the other PayPal members, then Merlyn", () => {
    expect(APPROVED_STATEMENT_REQUESTS).toHaveLength(11);
    expect(APPROVED_STATEMENT_REQUESTS.filter((r) => r.member_no === "M-014").map((r) => r.lang)).toEqual([
      "ceb",
      "fil",
      "en",
    ]);
    expect(new Set(APPROVED_STATEMENT_REQUESTS.map((r) => `${r.member_no}/${r.lang}`)).size).toBe(11);
    expect(APPROVED_STATEMENT_REQUESTS.at(-1)).toMatchObject({ member_no: "M-053", lang: "ceb" });
  });

  it("says the verdict is unknown while nobody has read the daily limit, and what limit would fit", () => {
    const p = requestPlan({ value: null, source: "not read yet" }, SELF_IMPOSED_DAILY_CAP);
    expect(p.requests).toMatchObject({
      approvedPlanStatements: 11,
      registerFullPlanStatements: 66,
      narrationBeats: 10,
    });
    expect(p.minimumDailyLimitForSchedule).toBe(6);
    expect(p.days).toEqual({
      approvedPlanStatements: null,
      registerFullPlanStatements: null,
      narrationAtFinalsCap: 4,
    });
    expect(p.daysAtSelfImposedCap).toEqual({
      cap: 10,
      approvedPlanStatements: 2,
      registerFullPlanStatements: 7,
    });
    expect(p.verdict).toMatch(/^UNKNOWN: .*at least 6 a day/);
  });

  it("decides once a limit is recorded", () => {
    expect(requestPlan({ value: 10, source: "AI Studio" }, 10).verdict).toMatch(
      /^FITS: 11 statement requests at 10 a day take 2 day/,
    );
    expect(requestPlan({ value: 5, source: "AI Studio" }, 5)).toMatchObject({
      days: { approvedPlanStatements: 3, registerFullPlanStatements: 14 },
      verdict: expect.stringMatching(/^DOES NOT FIT/),
    });
    expect(daysNeeded(0, 3)).toBe(0);
    expect(() => daysNeeded(3, 0)).toThrow(/positive/);
  });

  it("keeps S10 pending on the listening test, and on the daily limit until it is read", () => {
    expect(s10Verdict(null)).toMatchObject({
      status: "PENDING",
      asrCheck: expect.stringMatching(/proxy only/),
    });
    expect(s10Verdict(null).waitsOn).toHaveLength(2);
    expect(s10Verdict(20).waitsOn).toEqual([expect.stringMatching(/listening test/)]);
  });
});

describe("TTS daily cap", () => {
  it("is self-imposed and labelled as a guess until a person records the AI Studio figure", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "fs-quota-")), ".quota.json");
    let t = Date.parse("2026-10-23T16:00:00Z");
    const ledger = new QuotaLedger(
      path,
      () => new Date(t),
      async () => undefined,
    );
    const q = await ledger.read();
    expect(SELF_IMPOSED_DAILY_CAP).toBe(10);
    expect(q.capsSource).toMatch(/guess, not a measured limit/);
    await expect(ledger.setDailyLimit("gemini-3.8-flash-tts", 0, "AI Studio")).rejects.toThrow(/positive/);
    await expect(ledger.setDailyLimit("gemini-3.8-flash-tts", 2, " ")).rejects.toThrow(
      /where the figure was read/,
    );
    await ledger.setDailyLimit("gemini-3.8-flash-tts", 2, "AI Studio rate-limit page, 23 Oct");
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.dailyLimits["gemini-3.8-flash-tts"]).toMatchObject({
      value: 2,
      source: "AI Studio rate-limit page, 23 Oct",
    });
    expect(after.caps["gemini-3.8-flash-tts"]).toBe(2);
    await ledger.reserve("gemini-3.8-flash-tts", "0a1b2c3d");
    t += 30_000;
    await ledger.reserve("gemini-3.8-flash-tts", "0a1b2c3d");
    t += 30_000;
    await expect(ledger.reserve("gemini-3.8-flash-tts", "0a1b2c3d")).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });
});

describe("committed S10 report", () => {
  const report = JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", "spike-s10.json"), "utf8"));

  it("records the request plan and a pending verdict, and calls the ASR check a proxy", () => {
    expect(report.requestPlan.byModel["gemini-3.8-flash-tts"].requests.approvedPlanStatements).toBe(11);
    expect(report.requestPlan.byModel["gemini-3.8-flash-tts"].dailyLimit.value).toBeNull();
    expect(report.verdict.status).toBe("PENDING");
    expect(report.asrCheck.proxyOnly).toBe(true);
    expect(report.asrCheck.limits).toMatch(/proxy only/);
  });
});
