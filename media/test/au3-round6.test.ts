import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { alignWords } from "../src/tts/alignment.js";
import { ASR_MODELS, cer } from "../src/tts/asr.js";
import { TTS_MODEL } from "../src/tts/gemini.js";
import { MEDIA_ROOT } from "../src/util/env.js";
import { sha256 } from "../src/util/hash.js";

const read = (file: string) => JSON.parse(readFileSync(join(MEDIA_ROOT, file), "utf8"));

it("inv.i8.round6-dispositions: resolves all 18 outstanding frozen variants", () => {
  const report = read("audio/statement-validation.json");
  expect(report.round).toBe(6);
  expect(Date.parse(report.startedAt)).toBeGreaterThanOrEqual(Date.parse("2026-11-11T08:00:00Z"));
  expect(report.remainingAtStart).toHaveLength(18);
  expect(report.asrModels).toEqual(ASR_MODELS);
  const previous = read("audio/history/round5-validation.json");
  expect(report.remainingAtStart).toEqual(
    previous.planned.flatMap((r: { request: string; sentences: Record<string, string>[] }) =>
      r.sentences
        .filter((s) => s.status !== "published")
        .map((s) => ({ request: r.request, slot: s.slot, variant: s.variant, textSha256: s.textSha256 })),
    ),
  );
  const plans = read("statement-plans.json");
  expect(report.planned).toHaveLength(plans.requests.length);
  let published = 0;
  for (const [index, request] of report.planned.entries()) {
    expect(request.request).toBe(`${plans.requests[index].member_no}:${plans.requests[index].lang}`);
    expect(request.sentences.map((s: { textSha256: string }) => s.textSha256)).toEqual(
      plans.requests[index].sentences.map((s: { textSha256: string }) => s.textSha256),
    );
    for (const sentence of request.sentences) {
      if (sentence.status === "published") {
        published++;
        continue;
      }
      expect(sentence.status).toBe("refused");
      expect(sentence.lastRefusal.detail.length).toBeGreaterThan(15);
      expect(Number.isFinite(Date.parse(sentence.lastRefusal.at))).toBe(true);
      expect(sentence.eligibilityReason.length).toBeGreaterThan(15);
    }
  }
  expect(published).toBe(report.published);
  expect(report.published + report.refused).toBe(101);
  expect(report.published - 83).toBe(report.added);
});

it("inv.i8.round6-budget: counts every physical request and retains six reservations", () => {
  const report = read("audio/statement-validation.json");
  expect(report.round).toBe(6);
  expect(report.headroomReserved).toBe(6);
  expect(report.requestCount).toBe(report.requests.length);
  for (const attempt of report.attempts) {
    expect(attempt.outcome).toMatch(/^(quality|verified|service|interrupted)$/);
    if (attempt.outcome === "interrupted") {
      expect(attempt.detail).toMatch(/outcome unknown/);
      expect(attempt.transcript).toBeUndefined();
      expect(attempt.cer).toBeUndefined();
    }
  }
  const exceptions = new Set(["M-007:ceb:PAY", "M-060:fil:PAY", "M-018:ceb:PREMIUM"]);
  for (const variant of report.remainingAtStart) {
    const takes = report.requests.filter(
      (r: { model: string; request: string; textSha256: string }) =>
        r.model === TTS_MODEL && r.request === variant.request && r.textSha256 === variant.textSha256,
    );
    expect(takes.length).toBeLessThanOrEqual(exceptions.has(`${variant.request}:${variant.slot}`) ? 1 : 2);
    expect(new Set(takes.map((r: { requestHash: string }) => r.requestHash)).size).toBe(takes.length);
  }
  for (const model of [TTS_MODEL, ...ASR_MODELS]) {
    expect(report.totals[model].remaining).toBeGreaterThanOrEqual(6);
    expect(report.totals[model].used - report.startTotals[model].used).toBe(
      report.requests.filter((r: { model: string }) => r.model === model).length,
    );
  }
  for (const request of report.requests) {
    expect(request.keyId).toMatch(/^[a-f0-9]{8}$/);
    expect(request.outcome).toMatch(/^(success|refused|interrupted)$/);
    if (request.outcome === "interrupted") expect(request.detail).toMatch(/Reservation retained/);
    expect(request.remainingBefore).toBeGreaterThan(6);
    if (request.model === TTS_MODEL) {
      expect(request.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(
        report.remainingAtStart.some(
          (v: { request: string; textSha256: string }) =>
            v.request === request.request && v.textSha256 === request.textSha256,
        ),
      ).toBe(true);
    }
  }
});

it("inv.i8.round6-proof: binds new AACs to unchanged strict text and measured anchors", () => {
  const report = read("audio/statement-validation.json");
  expect(report.round).toBe(6);
  const manifest = read("audio/manifest.json");
  const evidence = read("audio/statement-verification.json");
  const plans = read("statement-plans.json");
  for (const baseline of report.baseline) {
    const entry = manifest.entries.find((e: { file: string }) => e.file === baseline.file);
    expect(sha256(JSON.stringify(entry))).toBe(baseline.entrySha256);
    expect(sha256(readFileSync(join(MEDIA_ROOT, baseline.file)))).toBe(baseline.audioSha256);
  }
  const newProofs = evidence.clips.filter((p: { round?: number }) => p.round === 6);
  expect(newProofs).toHaveLength(report.added);
  for (const proof of newProofs) {
    const entry = manifest.entries.find((e: { file: string }) => e.file === proof.file);
    const request = plans.requests.find(
      (r: { member_no: string; lang: string }) => r.member_no === entry.member_no && r.lang === entry.lang,
    );
    const sentence = request.sentences.find((s: { textSha256: string }) => s.textSha256 === proof.textSha256);
    expect(proof.audioSha256).toBe(sha256(readFileSync(join(MEDIA_ROOT, proof.file))));
    expect(proof.threshold).toBe(0.12);
    expect(proof.cer).toBe(cer(sentence.text, proof.transcript));
    expect(proof.cer).toBeLessThanOrEqual(0.12);
    expect(ASR_MODELS).toContain(proof.asrModel);
    const anchors = [
      ...sentence.placeholders.map((p: { name: string }) => ({ ...p, ref: `fact:${p.name}` })),
      ...sentence.mentionSpans,
    ];
    const aligned = alignWords(proof.words, sentence.text, entry.duration_ms / 1000, anchors);
    expect(aligned).not.toBeNull();
    expect(entry.offsets).toEqual(aligned?.offsets);
    expect(entry.text).toBe(sentence.text);
    expect(entry.codec).toEqual({ codec: "aac", bit_rate_kbps: 32, channels: 1 });
    expect(entry.synthetic).toBe(true);
  }
});
