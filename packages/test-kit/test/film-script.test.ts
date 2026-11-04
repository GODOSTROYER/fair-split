import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_WORDS, MAX_WPM } from "./e19/script.js";

type Variant = "stand-in" | "real-reading";
interface Card {
  kind: string;
  heading: string;
  kicker?: string;
  items: readonly { at: number; text: string; detail?: string }[];
}
interface Beat {
  id: string;
  part: string;
  start: number;
  end: number;
  say: string;
  show: readonly string[];
  cues: readonly { at: number; picture: string }[];
  card?: Card;
}
interface Slot {
  id: string;
  beat: string;
  start: number;
  duration: number;
  source: string;
  state: string;
  phase: string | null;
  label: string | null;
  shows: string;
}
interface Script {
  READING_VARIANT: Variant;
  PARTS: readonly { id: string; start: number; end: number }[];
  FILM: { duration: number; firstCaption: string; endCard: readonly string[]; voiceDisclosure: string };
  CHAPTERS: readonly { start: number; title: string }[];
  ARCHITECTURE: {
    format: string;
    boxes: readonly { id: string; label: string }[];
    arrows: readonly (readonly [string, string])[];
    reveal: readonly {
      at: number;
      boxes: readonly string[];
      arrows: readonly (readonly [string, string])[];
    }[];
  };
  READING_VARIANTS: Record<Variant, { show: readonly string[]; requires: string | null }>;
  beats: readonly Beat[];
  CAPTURES: readonly Slot[];
  beatsForReading(variant: Variant): readonly Beat[];
  capturesForReading(variant: Variant): readonly Slot[];
}

// Load the standalone film data without widening test-kit's TypeScript rootDir or adding a dependency.
const scriptUrl = new URL("../../../video/script.ts", import.meta.url);
const film: Script = await import(scriptUrl.href);
const seed = JSON.parse(
  readFileSync(new URL("../../seed/snapshot/season-2026A.json", import.meta.url), "utf8"),
);
const words = (say: string) => say.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
const SIM = "Simulated PayPal sandbox";

describe("film script v4: a product video, overview first (ADR-0017)", () => {
  it("opens with the problem, the solution, the architecture and the highlights inside the first minute", () => {
    expect(film.beats.map((beat) => [beat.part, beat.id, beat.start, beat.end])).toEqual([
      ["overview", "problem", 0, 14],
      ["overview", "solution", 14, 30],
      ["overview", "architecture", 30, 44],
      ["overview", "highlights", 44, 57],
      ["deep-dive", "paper", 57, 65],
      ["deep-dive", "funding", 65, 73],
      ["deep-dive", "reading", 73, 83],
      ["deep-dive", "count-once", 83, 92],
      ["deep-dive", "holds", 92, 102],
      ["deep-dive", "signing", 102, 111],
      ["deep-dive", "payouts", 111, 121],
      ["deep-dive", "proof", 121, 129],
      ["deep-dive", "member", 129, 134],
      ["deep-dive", "listening", 134, 143],
      ["deep-dive", "impressive", 143, 154],
      ["close", "limits", 154, 167],
      ["close", "end", 167, 175],
    ]);
    expect(film.PARTS.map((part) => [part.id, part.start, part.end])).toEqual([
      ["overview", 0, 57],
      ["deep-dive", 57, 154],
      ["close", 154, 175],
    ]);
    expect(film.FILM.duration).toBe(175);
    expect(film.FILM.duration).toBeLessThanOrEqual(175);
    for (const [index, beat] of film.beats.entries()) {
      expect(beat.end).toBeGreaterThan(beat.start);
      expect(beat.start).toBe(index === 0 ? 0 : film.beats[index - 1]?.end);
      for (const cue of beat.cues) {
        expect(cue.at).toBeGreaterThanOrEqual(beat.start);
        expect(cue.at).toBeLessThan(beat.end);
      }
      for (const item of beat.card?.items ?? []) {
        expect(item.at, `${beat.id}: ${item.text}`).toBeGreaterThanOrEqual(beat.start);
        expect(item.at, `${beat.id}: ${item.text}`).toBeLessThan(beat.end);
      }
    }
    expect(film.CHAPTERS[0]?.start).toBe(0);
    for (const [index, chapter] of film.CHAPTERS.entries()) {
      // YouTube chapters need ten seconds each.
      const next = film.CHAPTERS[index + 1]?.start ?? film.FILM.duration;
      expect(next - chapter.start, chapter.title).toBeGreaterThanOrEqual(10);
    }
  });

  for (const variant of ["stand-in", "real-reading"] as const) {
    it(`${variant}: counts all speech, including member audio, within ${MAX_WORDS} words and ${MAX_WPM} wpm per beat`, () => {
      const beats = film.beatsForReading(variant);
      expect(beats.map((beat) => [beat.id, beat.start, beat.end])).toEqual(
        film.beats.map((beat) => [beat.id, beat.start, beat.end]),
      );
      expect(beats.reduce((sum, beat) => sum + words(beat.say), 0)).toBeLessThanOrEqual(MAX_WORDS);
      expect(beats.find((beat) => beat.id === "listening")?.say).not.toBe("");
      for (const beat of beats) {
        const perSecond = words(beat.say) / (beat.end - beat.start);
        expect(perSecond * 60, beat.id).toBeLessThanOrEqual(MAX_WPM);
        expect(perSecond, beat.id).toBeLessThanOrEqual(2.6);
      }
      // The member clip plays alone in its own beat (F4).
      expect(beats.find((beat) => beat.id === "listening")?.say).toBe(
        "Premium gikan sa Lantern Bay Chocolate Co.: forty-three dollars and sixty-nine cents, walay kaltas.",
      );
    });
  }

  it("inv.i8.film labels the simulated rail, synthetic people, the stand-in and synthetic voices", () => {
    for (const id of [
      "solution",
      "architecture",
      "highlights",
      "funding",
      "signing",
      "payouts",
      "proof",
      "member",
      "listening",
      "impressive",
      "limits",
      "end",
    ]) {
      expect(film.beats.find((beat) => beat.id === id)?.show, id).toContain(SIM);
    }
    expect(film.beats[0]?.show).toContain(film.FILM.firstCaption);
    for (const text of [SIM, "Synthetic people", "Gemini TTS"])
      expect(film.FILM.firstCaption).toContain(text);
    const end = film.FILM.endCard.join(" ");
    for (const text of [
      "untested against PayPal's own sandbox",
      "Synthetic people and data",
      "seed stand-in, not a Claude recording",
      "Gemini TTS",
    ])
      expect(end).toContain(text);
    expect(film.FILM.endCard.at(-1)).toBe(film.FILM.voiceDisclosure);
    expect(film.beats.at(-1)?.show).toEqual(expect.arrayContaining([...film.FILM.endCard]));
    const limits = film.beats.find((beat) => beat.id === "limits");
    expect(limits?.say).toContain("simulated sandbox");
    expect(limits?.say).toContain("no real farmer was paid");
    expect(limits?.say).toContain("stand-in");
    expect(limits?.say).toContain("Gemini TTS");
  });

  it("cuts to R1's real reading only as its own exhibit, and says the run is a labelled stand-in", () => {
    expect(film.READING_VARIANT).toBe("real-reading");
    expect(film.beats).toEqual(film.beatsForReading("real-reading"));
    const reading = film.beats.find((beat) => beat.id === "reading");
    expect(reading?.say).toContain("The run itself replays a labelled stand-in");
    // The exact exhibit caption C5d ships and E-19 allows, with R1's verified date; never the seed run's date.
    expect(reading?.show).toContain("Claude's real reading of this slip, recorded 1 Nov 2026");
    expect(reading?.show).toContain("Seed stand-in, not a Claude recording");
    expect(film.READING_VARIANTS["real-reading"].requires).toContain("R1");
    expect(film.READING_VARIANTS["real-reading"].requires).toContain("C5d");
    expect(film.READING_VARIANTS["stand-in"].requires).toBeNull();
    expect(film.beatsForReading("stand-in").find((beat) => beat.id === "reading")?.say).toContain(
      "Claude is built to read every slip twice; this replay is a labelled stand-in.",
    );
    expect(JSON.stringify(film.beats)).not.toContain(seed.run.recordedOn);
  });

  it("animates our own architecture SVG: every box and arrow arrives once, after its ends, inside its beat", () => {
    expect(film.ARCHITECTURE.format).toBe("original-svg");
    expect(film.ARCHITECTURE.boxes).toContainEqual({ id: "paypal", label: "PayPal simulator" });
    const beat = film.beats.find((item) => item.card?.kind === "architecture");
    const reveal = film.ARCHITECTURE.reveal;
    const added = reveal.flatMap((step) => [...step.boxes, ...step.arrows.map((arrow) => arrow.join(":"))]);
    expect([...added].sort()).toEqual(
      [
        ...film.ARCHITECTURE.boxes.map((box) => box.id),
        ...film.ARCHITECTURE.arrows.map((arrow) => arrow.join(":")),
      ].sort(),
    );
    expect(reveal[0]?.at).toBe(beat?.start);
    for (const [index, step] of reveal.entries()) {
      if (index) expect(step.at).toBeGreaterThan(reveal[index - 1]?.at ?? 0);
      expect(step.at).toBeLessThan(beat?.end ?? 0);
      const drawn = new Set(reveal.slice(0, index + 1).flatMap((s) => s.boxes));
      for (const [from, to] of step.arrows)
        expect(drawn.has(from) && drawn.has(to), `${from}:${to}`).toBe(true);
    }
  });

  it("shows every highlight the owner named, each from the real product", () => {
    const reel = film.CAPTURES.filter((slot) => slot.beat === "highlights");
    const labels = reel.map((slot) => slot.label ?? "").join(" | ");
    for (const feature of [
      "Split matrix (AG Grid)",
      "mass-balance dial",
      "refuses a change after ratification",
      "Two keys on one batch hash",
      "six checks in your browser",
      "Cebuano audio",
      "tap a peso back to its slip",
      "Try to break it",
    ])
      expect(labels).toContain(feature);
    for (const slot of film.CAPTURES) {
      expect(["console film mode", "phone recording", "Proof in the browser"]).toContain(slot.source);
      expect(slot.shows.length, slot.id).toBeGreaterThan(20);
      if (slot.phase) expect(slot.state, slot.id).toMatch(/^MM-[\dS]+ on /);
    }
    // Card beats are original typography; every other beat is covered end to end by real captures.
    for (const beat of film.beats) {
      const slots = film.CAPTURES.filter((slot) => slot.beat === beat.id);
      if (beat.card) expect(slots, beat.id).toEqual([]);
      else
        expect(
          slots.reduce((sum, slot) => sum + slot.duration, 0),
          beat.id,
        ).toBe(beat.end - beat.start);
    }
    expect(film.capturesForReading("stand-in").map((slot) => [slot.id, slot.start])).toEqual(
      film.CAPTURES.map((slot) => [slot.id, slot.start]),
    );
  });

  it("uses IC-03 figures, the narrowed prior-art line, and no runtime package imports", () => {
    const show = film.beats
      .flatMap((beat) => [
        ...beat.show,
        beat.card?.kicker ?? "",
        ...(beat.card?.items ?? []).flatMap((item) => [item.text, item.detail ?? ""]),
      ])
      .join(" ");
    expect(show).toContain(seed.figures.display.invoice);
    expect(show).toContain(seed.figures.display.batchTotal);
    expect(show).toContain(seed.figures.display.proofShare);
    expect(show).toContain(`US$${(seed.figures.redirectedDuplicateCents / 100).toFixed(2)}`);
    expect(show).toContain(`US$${(seed.rateCard.canonical.rules.cosign.batchOverCents / 100).toFixed(2)}`);
    expect(show).toContain("None we found starts from a handwritten weigh-slip.");
    const source = readFileSync(scriptUrl, "utf8");
    expect(source).not.toMatch(/protect[s]? a payer/i);
    expect(source).not.toMatch(/protects the people being paid/i);
    expect(source.match(/from\s+["'](?!node:)[^"']+["']/g) ?? []).toEqual([]);
  });
});
