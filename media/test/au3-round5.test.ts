import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MEDIA_ROOT } from "../src/util/env.js";

// Keep every round-five assertion against its immutable historical receipt.
const read = (file: string) =>
  JSON.parse(
    readFileSync(
      join(
        MEDIA_ROOT,
        file === "audio/statement-validation.json" ? "audio/history/round5-validation.json" : file,
      ),
      "utf8",
    ),
  );

it("inv.i8.round5-reset: records a bounded retry after the approved reset", () => {
  const report = read("audio/statement-validation.json");
  expect(report.round).toBe(5);
  expect(Date.parse(report.startedAt)).toBeGreaterThanOrEqual(Date.parse("2026-11-05T08:00:00Z"));
  expect(report.asrModels).toEqual(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"]);
  expect(report.retryOrder.slice(0, 10).map((r: { request: string }) => r.request)).toEqual([
    ...Array(6).fill("M-039:en"),
    ...Array(4).fill("M-053:ceb"),
  ]);
  expect(
    report.retryOrder
      .slice(0, 10)
      .every((r: { previousStatus: string }) => r.previousStatus === "waiting_on_service"),
  ).toBe(true);
});

it("inv.i8.round5-disposition: accounts for every frozen variant and gives each refusal an eligibility reason", () => {
  const report = read("audio/statement-validation.json");
  const plans = read("statement-plans.json");
  expect(report.planned.map((r: { request: string }) => r.request)).toEqual(
    plans.requests.map((r: { member_no: string; lang: string }) => `${r.member_no}:${r.lang}`),
  );
  let count = 0;
  for (const [index, request] of report.planned.entries()) {
    expect(request.sentences.map((s: { textSha256: string }) => s.textSha256)).toEqual(
      plans.requests[index].sentences.map((s: { textSha256: string }) => s.textSha256),
    );
    for (const sentence of request.sentences) {
      count++;
      if (sentence.status === "published") continue;
      expect(sentence.reason.length).toBeGreaterThan(15);
      expect(sentence.lastRefusal.kind).toMatch(/quality|service|quota/);
      expect(sentence.lastRefusal.detail.length).toBeGreaterThan(15);
      expect(Number.isFinite(Date.parse(sentence.lastRefusal.at))).toBe(true);
      expect(sentence.eligibilityReason.length).toBeGreaterThan(15);
      expect(sentence).toHaveProperty("nextEligibleAt");
      if (sentence.nextEligibleAt !== null)
        expect(Number.isFinite(Date.parse(sentence.nextEligibleAt))).toBe(true);
      else expect(sentence.eligibilityReason).toMatch(/unknown/i);
    }
  }
  expect(count).toBe(101);
});

it("inv.i8.round5-evidence: only counts current independently verified AAC bytes as published", async () => {
  const { sha256 } = await import("../src/util/hash.js");
  const manifest = read("audio/manifest.json");
  const evidence = read("audio/statement-verification.json");
  const report = read("audio/statement-validation.json");
  for (const request of report.planned) {
    for (const sentence of request.sentences) {
      if (sentence.status !== "published") continue;
      const entry = manifest.entries.find(
        (e: { member_no: string; lang: string; text_sha256: string; draft: boolean }) =>
          `${e.member_no}:${e.lang}` === request.request && e.text_sha256 === sentence.textSha256 && !e.draft,
      );
      expect(entry).toBeDefined();
      const proof = evidence.clips.find((e: { file: string }) => e.file === entry.file);
      expect(proof.textSha256).toBe(sentence.textSha256);
      expect(proof.audioSha256).toBe(sha256(readFileSync(join(MEDIA_ROOT, entry.file))));
      expect(proof.threshold).toBe(0.12);
      expect(proof.cer).toBeGreaterThanOrEqual(0);
      expect(proof.cer).toBeLessThanOrEqual(0.12);
      expect(entry.codec).toEqual({ codec: "aac", bit_rate_kbps: 32, channels: 1 });
    }
  }
});

it("inv.i8.round5-take-accounting: discloses cumulative overruns without refunding reservations", () => {
  const report = read("audio/statement-validation.json");
  expect(report.takeBudgetAudit.limit).toBe(2);
  expect(report.takeBudgetAudit.uniqueFreshRequests).toBe(report.totals["gemini-3.8-flash-tts"].used);
  for (const variant of report.takeBudgetAudit.variants) {
    if (variant.takes.length <= report.takeBudgetAudit.limit) continue;
    const exception = report.takeBudgetAudit.overruns.find(
      (x: { request: string; textSha256: string }) =>
        x.request === variant.request && x.textSha256 === variant.textSha256,
    );
    expect(exception).toBeDefined();
    expect(exception.actual).toBe(variant.takes.length);
    expect(exception.reason).toMatch(/passes/);
    expect(exception.reservationsRetained).toBe(true);
  }
});
