import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../../../media/audio/manifest.json";
import exported from "../../../../media/statement-plans.json";
import { audioPlan, statementSentences } from "../lib/statement";
import { buildDemoStatement } from "./demo-fixtures";
import { withDemoStatementExport } from "./demo-statement-export";

const LANGS = ["ceb", "fil", "en"] as const;
const now = "2026-11-01T09:00:00.000Z";

describe("K1d: M-014 uses the committed statement export and published audio", () => {
  it.each(LANGS)("%s: exact display and spoken text comes from fs-api's export", (lang) => {
    const request = exported.requests.find((r) => r.member_no === "M-014" && r.lang === lang);
    expect(request).toBeDefined();
    const dto = buildDemoStatement({ stage: "paid", now });
    const result = statementSentences(dto, lang);
    expect(result.rejected).toEqual([]);
    expect(result.sentences.map((s) => s.display)).toEqual(request?.sentences.map((s) => s.displayText));
    expect(result.sentences.map((s) => s.spoken)).toEqual(request?.sentences.map((s) => s.text));
    expect(result.sentences.find((s) => s.slot === "AI_NOTE")?.spoken).toMatch(/demo/);
  });

  it.each(LANGS)(
    "%s: chooses every published exact clip and keeps missing sentences on device voice",
    (lang) => {
      const dto = buildDemoStatement({ stage: "paid", now });
      const request = exported.requests.find((r) => r.member_no === "M-014" && r.lang === lang);
      const plan = audioPlan(dto, lang, { deviceVoice: true });
      const served = dto.audio[lang] ?? [];
      expect(served).toHaveLength(request?.sentences.length ?? 0);
      for (const sentence of request?.sentences ?? []) {
        const entry = manifest.entries.find(
          (e) =>
            e.member_no === "M-014" &&
            e.lang === lang &&
            e.slot === sentence.slot &&
            !e.draft &&
            e.text_sha256 === sentence.textSha256 &&
            e.text === sentence.text,
        );
        const step = plan.steps.find((s) => s.slot === sentence.slot);
        if (entry) {
          expect(existsSync(new URL(`../../../../media/${entry.file}`, import.meta.url))).toBe(true);
          expect(step?.voice).toMatchObject({ kind: "clip", url: `/media/${entry.file}` });
          expect(served.find((s) => s.slot === sentence.slot)?.clip?.textSha256).toBe(sentence.textSha256);
        } else expect(step?.voice.kind).toBe("device");
      }
      expect(dto.lineId).toBe("line_2026A_r37_M-014");
    },
  );

  it("does not play the approved PayPal sentence after the demo moves to cash or checking", () => {
    for (const stage of ["checking", "cash-due", "cash-received"] as const) {
      const dto = buildDemoStatement({ stage, now });
      const plan = audioPlan(dto, "ceb", { deviceVoice: true });
      expect(plan.steps.find((s) => s.slot === "PAY")?.voice.kind).toBe("device");
      if (stage !== "checking")
        expect(statementSentences(dto, "ceb").sentences.find((s) => s.slot === "PAY")?.spoken).not.toContain(
          "sa inyong PayPal",
        );
    }
  });

  it("automatically picks up every newly published sentence from the manifest", () => {
    const dto = buildDemoStatement({ stage: "paid", now });
    const request = exported.requests.find((r) => r.member_no === "M-014" && r.lang === "ceb");
    const entries =
      request?.sentences.map((s, i) => ({
        member_no: "M-014",
        lang: "ceb",
        slot: s.slot,
        text: s.text,
        text_sha256: s.textSha256,
        synthetic: true,
        draft: false,
        duration_ms: 1000,
        file: `audio/M-014/ceb/s${i}-${s.slot}-${s.textSha256.slice(0, 12)}.m4a`,
      })) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    const plan = audioPlan(withDemoStatementExport(dto, entries), "ceb", { deviceVoice: true });
    expect(plan.steps.map((s) => s.voice.kind)).toEqual(entries.map(() => "clip"));
    expect(plan.mode).toBe("synthetic");
  });

  it("locates slip cues in fs-api's exact spoken digit words for device voice", () => {
    const dto = withDemoStatementExport(buildDemoStatement({ stage: "paid", now }), []);
    const plan = audioPlan(dto, "en", { deviceVoice: true });
    const sources = plan.steps.find((s) => s.slot === "SOURCES");
    expect(sources?.voice.kind).toBe("device");
    expect(sources?.cues.map((c) => c.serial)).toEqual(["0403", "0419", "0436", "0467"]);
    const indices = sources?.cues.map((c) => c.charIndex) ?? [];
    expect(indices[0]).toBe(sources?.spoken.indexOf("zero four zero three"));
    expect(indices.every((at, i) => i === 0 || at > (indices[i - 1] ?? 0))).toBe(true);
  });

  it("drafts, mismatched words or hashes, unsafe paths, and malformed offsets keep device voice", () => {
    const dto = buildDemoStatement({ stage: "paid", now });
    const sentence = exported.requests.find((r) => r.member_no === "M-014" && r.lang === "ceb")?.sentences[0];
    expect(sentence).toBeDefined();
    const good = {
      member_no: "M-014",
      lang: "ceb",
      slot: sentence?.slot,
      text: sentence?.text,
      text_sha256: sentence?.textSha256,
      synthetic: true,
      draft: false,
      duration_ms: 1000,
      file: "audio/M-014/ceb/s01-test.m4a",
    };
    for (const bad of [
      { ...good, draft: true },
      { ...good, synthetic: false },
      { ...good, text: "Old words" },
      { ...good, text_sha256: "f".repeat(64) },
      { ...good, file: "audio/M-014/en/s01-test.m4a" },
      { ...good, file: "audio/drafts/M-014/ceb/s01-test.m4a" },
      { ...good, offsets: [{ ref: "fact:HONORIFIC_NAME", at_ms: -1 }] },
    ]) {
      const demo = withDemoStatementExport(dto, [bad]);
      const plan = audioPlan(demo, "ceb", { deviceVoice: true });
      expect(plan.steps.every((s) => s.voice.kind === "device")).toBe(true);
      expect(demo.audio.ceb?.every((s) => s.clip === null)).toBe(true);
    }
  });
});
