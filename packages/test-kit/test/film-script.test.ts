import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Variant = "stand-in" | "real-reading";
interface Beat {
  id: string;
  start: number;
  end: number;
  say: string;
  show: readonly string[];
  cues: readonly { at: number; picture: string }[];
}
interface Script {
  READING_VARIANT: Variant;
  FILM: { duration: number; firstCaption: string; endCard: readonly string[] };
  CHAPTERS: readonly { start: number; title: string }[];
  ARCHITECTURE: { format: string; boxes: readonly { id: string; label: string }[] };
  READING_VARIANTS: Record<Variant, { show: readonly string[]; requires: string | null }>;
  beats: readonly Beat[];
  beatsForReading(variant: Variant): readonly Beat[];
}

// Load the standalone film data without widening test-kit's TypeScript rootDir or adding a dependency.
const scriptUrl = new URL("../../../video/script.ts", import.meta.url);
const film: Script = await import(scriptUrl.href);
const seed = JSON.parse(
  readFileSync(new URL("../../seed/snapshot/season-2026A.json", import.meta.url), "utf8"),
);
const words = (say: string) => say.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

describe("film script v3", () => {
  it("keeps the plan's beats, chapter marks and contiguous 2:50 timeline", () => {
    expect(film.beats.map((beat) => [beat.id, beat.start, beat.end])).toEqual([
      ["arrival", 0, 9],
      ["title", 9, 20],
      ["funding", 20, 32],
      ["reading", 32, 44],
      ["duplicate", 44, 56],
      ["rules", 56, 70],
      ["signing", 70, 84],
      ["payouts", 84, 102],
      ["proof", 102, 120],
      ["listening", 120, 132],
      ["architecture", 132, 154],
      ["limits", 154, 170],
    ]);
    expect(film.CHAPTERS.map((chapter) => chapter.start)).toEqual([0, 20, 32, 44, 56, 70, 84, 102, 120, 132]);
    expect(film.FILM.duration).toBe(170);
    expect(film.FILM.duration).toBeLessThanOrEqual(175);
    for (const [index, beat] of film.beats.entries()) {
      expect(beat.end).toBeGreaterThan(beat.start);
      expect(beat.start).toBe(index === 0 ? 0 : film.beats[index - 1]?.end);
      for (const cue of beat.cues) {
        expect(cue.at).toBeGreaterThanOrEqual(beat.start);
        expect(cue.at).toBeLessThan(beat.end);
      }
    }
    expect(film.beats.find((beat) => beat.id === "reading")?.cues.map((cue) => cue.at)).toContain(42);
    expect(film.beats.find((beat) => beat.id === "rules")?.cues.map((cue) => cue.at)).toContain(64);
  });

  for (const variant of ["stand-in", "real-reading"] as const) {
    it(`${variant}: counts all speech, including member audio, within 240 words and 140 wpm per beat`, () => {
      const beats = film.beatsForReading(variant);
      expect(beats.map((beat) => [beat.id, beat.start, beat.end])).toEqual(
        film.beats.map((beat) => [beat.id, beat.start, beat.end]),
      );
      expect(beats.reduce((sum, beat) => sum + words(beat.say), 0)).toBeLessThanOrEqual(240);
      expect(beats.find((beat) => beat.id === "listening")?.say).not.toBe("");
      for (const beat of beats) {
        expect((words(beat.say) * 60) / (beat.end - beat.start), beat.id).toBeLessThanOrEqual(140);
      }
    });
  }

  it("inv.i8.film labels the simulated rail and synthetic voices at the required beats", () => {
    for (const start of [0, 20, 84, 154]) {
      expect(film.beats.find((beat) => beat.start === start)?.show).toContain("Simulated PayPal sandbox");
    }
    expect(film.FILM.firstCaption).toContain("Gemini TTS");
    expect(film.FILM.endCard.join(" ")).toContain("Gemini TTS");
    expect(film.FILM.endCard.join(" ")).toContain("untested against PayPal's own sandbox");
    expect(film.READING_VARIANT).toBe("stand-in");
    expect(film.beats).toEqual(film.beatsForReading("stand-in"));
    expect(film.beats.find((beat) => beat.id === "reading")?.say).toContain(
      "Claude is built to read every slip twice; this replay is a labelled stand-in.",
    );
    expect(film.READING_VARIANTS["stand-in"].requires).toBeNull();
    expect(film.READING_VARIANTS["real-reading"].requires).toContain("R1");
    expect(film.READING_VARIANTS["real-reading"].requires).toContain("C5d");
    expect(film.READING_VARIANTS["real-reading"].show.join(" ")).toContain(
      "Claude's real reading of this slip, recorded {date}",
    );
  });

  it("uses our own architecture SVG and IC-03 figures without importing runtime packages", () => {
    expect(film.ARCHITECTURE.format).toBe("original-svg");
    expect(film.ARCHITECTURE.boxes).toContainEqual({ id: "paypal", label: "PayPal simulator" });
    const show = film.beats.flatMap((beat) => beat.show).join(" ");
    expect(show).toContain(seed.figures.display.invoice);
    expect(show).toContain(seed.figures.display.batchTotal);
    expect(show).toContain(seed.figures.display.proofShare);
    expect(show).toContain(`US$${(seed.figures.redirectedDuplicateCents / 100).toFixed(2)}`);
    expect(show).toContain(`US$${(seed.rateCard.canonical.rules.cosign.batchOverCents / 100).toFixed(2)}`);
    const source = readFileSync(scriptUrl, "utf8");
    expect(source.match(/from\s+["'](?!node:)[^"']+["']/g) ?? []).toEqual([]);
  });
});
