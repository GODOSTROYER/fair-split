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
  speech?: readonly [number, number];
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
  word: string | null;
  overlay: readonly string[];
  shows: string;
  reference: string | null;
}
interface Script {
  READING_VARIANT: Variant;
  PARTS: readonly { id: string; start: number; end: number; bumper: string | null }[];
  FILM: {
    duration: number;
    firstCaption: string;
    endCard: readonly string[];
    voiceDisclosure: string;
    descriptionDisclosure: string;
  };
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
  READING_VARIANTS: Record<Variant, { say: string; cut: string; requires: string | null }>;
  REAL_READING_CAPTION: string;
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
const spoken = (say: string) => say.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word));
const words = (say: string) => spoken(say).length;
const SIM = "Simulated PayPal sandbox";
const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
const beat = (id: string, beats: readonly Beat[] = film.beats): Beat => {
  const found = beats.find((item) => item.id === id);
  if (!found) throw new Error(`no beat ${id}`);
  return found;
};
/** When `phrase` is said in `b`, word-proportionally across its speech window (as captions are timed). */
function said(b: Beat, phrase: string): number {
  const list = spoken(b.say);
  const want = phrase.toLowerCase().split(/\s+/u);
  const index = list.findIndex((_, i) =>
    want.every((w, k) => (list[i + k] ?? "").toLowerCase().replace(/^\W+/u, "").startsWith(w)),
  );
  if (index < 0) throw new Error(`${b.id}: "${phrase}" is not spoken`);
  const [from, to] = b.speech ?? [b.start, b.end];
  return from + ((to - from) * index) / list.length;
}
/** Every line a viewer reads: beat lines, card text and the clips' own evidence lines. */
const onScreen = (beats: readonly Beat[], slots: readonly Slot[]) =>
  [
    ...beats.flatMap((b) => [
      ...b.show,
      b.card?.kicker ?? "",
      ...(b.card?.items ?? []).flatMap((item) => [item.text, item.detail ?? ""]),
    ]),
    ...slots.flatMap((slot) => [...slot.overlay, slot.label ?? ""]),
  ].join(" ");

describe("film script v4: a product video, overview first (ADR-0017)", () => {
  it("opens with the problem, the solution, the architecture and the highlights inside the first minute", () => {
    expect(film.beats.map((b) => [b.part, b.id, b.start, b.end])).toEqual([
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
    // The judge is told the overview is over and the deep dive begins.
    expect(film.PARTS.find((part) => part.id === "deep-dive")?.bumper).toMatch(/^The deep dive/);
    expect(film.FILM.duration).toBe(175);
    expect(film.FILM.duration).toBeLessThanOrEqual(175);
    for (const [index, b] of film.beats.entries()) {
      expect(b.end).toBeGreaterThan(b.start);
      expect(b.start).toBe(index === 0 ? 0 : film.beats[index - 1]?.end);
      for (const cue of b.cues) {
        expect(cue.at).toBeGreaterThanOrEqual(b.start);
        expect(cue.at).toBeLessThan(b.end);
      }
      for (const item of b.card?.items ?? []) {
        expect(item.at, `${b.id}: ${item.text}`).toBeGreaterThanOrEqual(b.start);
        expect(item.at, `${b.id}: ${item.text}`).toBeLessThan(b.end);
      }
    }
    expect(film.CHAPTERS[0]?.start).toBe(0);
    for (const [index, chapter] of film.CHAPTERS.entries()) {
      // YouTube chapters need ten seconds each, and each starts on a beat.
      const next = film.CHAPTERS[index + 1]?.start ?? film.FILM.duration;
      expect(next - chapter.start, chapter.title).toBeGreaterThanOrEqual(10);
      expect(
        film.beats.some((b) => b.start === chapter.start),
        chapter.title,
      ).toBe(true);
    }
  });

  for (const variant of ["stand-in", "real-reading"] as const) {
    it(`${variant}: counts all speech, including member audio, within ${MAX_WORDS} words and ${MAX_WPM} wpm per beat`, () => {
      const beats = film.beatsForReading(variant);
      expect(beats.map((b) => [b.id, b.start, b.end])).toEqual(film.beats.map((b) => [b.id, b.start, b.end]));
      expect(beats.reduce((sum, b) => sum + words(b.say), 0)).toBeLessThanOrEqual(MAX_WORDS);
      expect(beat("listening", beats).say).not.toBe("");
      for (const b of beats) {
        const perSecond = words(b.say) / (b.end - b.start);
        expect(perSecond * 60, b.id).toBeLessThanOrEqual(MAX_WPM);
        expect(perSecond, b.id).toBeLessThanOrEqual(2.6);
        // A beat that speaks in only part of its time keeps the same pace limit inside that window.
        const [from, to] = b.speech ?? [b.start, b.end];
        expect(from, b.id).toBeGreaterThanOrEqual(b.start);
        expect(to, b.id).toBeLessThanOrEqual(b.end);
        expect((words(b.say) / (to - from)) * 60, `${b.id} in its speech window`).toBeLessThanOrEqual(
          MAX_WPM,
        );
      }
      // The member clip plays alone in its own beat (F4).
      expect(beat("listening", beats).say).toBe(
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
      expect(beat(id).show, id).toContain(SIM);
    }
    expect(film.beats[0]?.show).toContain(film.FILM.firstCaption);
    // The first caption rail names the reading stand-in too, before Claude is first named at 0:14.
    for (const text of [SIM, "Synthetic people", "stand-in", "Gemini TTS"])
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
    const limits = beat("limits");
    expect(limits.say).toContain("simulated sandbox");
    expect(limits.say).toContain("no real farmer was paid");
    expect(limits.say).toContain("stand-in");
    expect(limits.say).toContain("Gemini TTS");
    // The images are synthetic, and the film and its description say how they were made.
    const limitLines = (limits.card?.items ?? []).map((item) => item.text).join(" ");
    expect(limitLines).toMatch(/Codex-made hero flats/);
    expect(limitLines).toMatch(/photos A–L composed in code/);
    expect(film.FILM.descriptionDisclosure).toMatch(/Slip images are synthetic: Codex-made/);
    // Disclosure lines arrive one word apart, never three at once.
    const times = (limits.card?.items ?? []).map((item) => item.at);
    for (const t of new Set(times)) expect(times.filter((x) => x === t).length).toBeLessThanOrEqual(2);
  });

  it("never presents the synthetic co-op as fact, nor images, photos or tests it does not have", () => {
    // The first words judges hear frame the season as a picture; the kicker says it is synthetic.
    expect(beat("problem").say).toMatch(/^Picture /);
    expect(beat("problem").card?.kicker).toMatch(/^A synthetic /);
    const white = seed.slips.filter((slip: { copy: string }) => slip.copy === "WHITE_ORIGINAL").length;
    expect(beat("problem").card?.kicker).toContain(`${white} weigh-slips`);
    const shown = onScreen(film.beats, film.CAPTURES);
    // Only photos A–L are imaged (composed in code); the other photo records are manifest rows.
    expect(shown).not.toMatch(new RegExp(`\\b${seed.figures.slipImages}\\b`));
    expect(shown).not.toMatch(new RegExp(`\\b${seed.figures.photos} photos\\b`));
    expect(shown).not.toMatch(/slip images ·|photographed weigh-slips/);
    expect(shown).toContain("This run: 12 photos (A–L), 48 slips · composed in code");
    expect(film.CAPTURES.find((slot) => slot.id === "paper-photos")?.shows).toContain(
      "Code-composed · synthetic",
    );
    // 33 is Playwright's listed count, not a run count (some specs are fixme or skip).
    expect(shown).not.toMatch(/33 Playwright/);
    // The hosted demo has no evidence yet (replan-1031 §6): no hosting box.
    expect(film.ARCHITECTURE.boxes.map((box) => box.label).join(" ")).not.toMatch(/\bRender\b/);
  });

  it("states the co-sign rule as conditional: large batches, the R5 limits", () => {
    const { batchOverCents, lineOverCents } = seed.rateCard.canonical.rules.cosign;
    expect(beat("solution").say).toContain("Two officers sign large batches.");
    const keys = beat("solution").card?.items.find((item) => item.text.startsWith("Two officers"));
    expect(keys?.detail).toBe(
      `over ${usd(batchOverCents)} a batch or ${usd(lineOverCents)} a line, or any override`,
    );
    expect(film.ARCHITECTURE.boxes.find((box) => box.id === "keys")?.label).toContain(
      "over the co-sign limits",
    );
    expect(beat("signing").say).toMatch(/^Above three hundred dollars, two keys/);
  });

  it("names the buyer once and keeps one name for it", () => {
    expect(beat("funding").say).toMatch(/^Lantern Bay, the chocolate buyer,/);
    for (const id of ["problem", "solution", "end"]) {
      expect(beat(id).say, id).toMatch(/\bthe buyer\b/i);
      expect(beat(id).say, id).not.toMatch(/\bbrand\b/);
    }
  });

  it("cuts to R1's real reading only as its own exhibit, and says the run is a labelled stand-in", () => {
    expect(film.READING_VARIANT).toBe("real-reading");
    expect(film.beats).toEqual(film.beatsForReading("real-reading"));
    const reading = beat("reading");
    expect(reading.say).toContain("The run itself replays a labelled stand-in");
    // The exact exhibit caption C5d ships and E-19 allows, with R1's verified date; never the seed run's date.
    expect(film.REAL_READING_CAPTION).toBe("Claude's real reading of this slip, recorded 1 Nov 2026");
    // Each label is timed to its own clip: the real caption only over the exhibit, the stand-in over the run.
    for (const b of film.beats) expect(b.show, b.id).not.toContain(film.REAL_READING_CAPTION);
    const [exhibit, byHand] = film.CAPTURES.filter((slot) => slot.beat === "reading");
    expect(exhibit?.state).toMatch(/^Hero-slip exhibit tile 'Slip 0403/);
    expect(exhibit?.overlay).toContain(film.REAL_READING_CAPTION);
    expect(exhibit?.overlay.join(" ")).toMatch(
      /Codex-made synthetic slip image · labels agent-checked, provisional/,
    );
    expect(exhibit?.overlay.join(" ")).not.toMatch(/stand-in/);
    expect(exhibit?.shows).toContain("Never the slip 0449 tile");
    expect(byHand?.overlay.join(" ")).toContain("Seed stand-in, not a Claude recording");
    expect(byHand?.overlay).not.toContain(film.REAL_READING_CAPTION);
    for (const slot of film.CAPTURES)
      if (slot.overlay.includes(film.REAL_READING_CAPTION)) expect(slot.id).toBe("reading-console");
    // The cut to the run lands on "The run itself".
    expect(Math.abs((byHand?.start ?? 0) - said(reading, "the run"))).toBeLessThanOrEqual(0.3);
    expect(film.READING_VARIANTS["real-reading"].requires).toContain("R1");
    expect(film.READING_VARIANTS["real-reading"].requires).toContain("C5d");
    expect(film.READING_VARIANTS["stand-in"].requires).toBeNull();
    expect(beat("reading", film.beatsForReading("stand-in")).say).toContain(
      "Claude is built to read every slip twice; this replay is a labelled stand-in.",
    );
    expect(
      film
        .capturesForReading("stand-in")
        .flatMap((slot) => slot.overlay)
        .includes(film.REAL_READING_CAPTION),
    ).toBe(false);
    expect(JSON.stringify(film.beats)).not.toContain(seed.run.recordedOn);
  });

  it("animates our own architecture SVG: every box and arrow arrives once, after its ends, then holds", () => {
    expect(film.ARCHITECTURE.format).toBe("original-svg");
    expect(film.ARCHITECTURE.boxes).toContainEqual({ id: "paypal", label: "PayPal simulator" });
    expect(film.ARCHITECTURE.boxes.length).toBeLessThanOrEqual(10);
    const arch = film.beats.find((item) => item.card?.kind === "architecture");
    const reveal = film.ARCHITECTURE.reveal;
    const added = reveal.flatMap((step) => [...step.boxes, ...step.arrows.map((arrow) => arrow.join(":"))]);
    expect([...added].sort()).toEqual(
      [
        ...film.ARCHITECTURE.boxes.map((box) => box.id),
        ...film.ARCHITECTURE.arrows.map((arrow) => arrow.join(":")),
      ].sort(),
    );
    expect(reveal[0]?.at).toBe(arch?.start);
    for (const [index, step] of reveal.entries()) {
      if (index) expect(step.at).toBeGreaterThan(reveal[index - 1]?.at ?? 0);
      expect(step.at).toBeLessThan(arch?.end ?? 0);
      const drawn = new Set(reveal.slice(0, index + 1).flatMap((s) => s.boxes));
      for (const [from, to] of step.arrows)
        expect(drawn.has(from) && drawn.has(to), `${from}:${to}`).toBe(true);
    }
    // The narration ends early so the finished diagram holds long enough to read.
    expect((arch?.end ?? 0) - (reveal.at(-1)?.at ?? 0)).toBeGreaterThanOrEqual(3);
    expect(arch?.speech?.[1]).toBeLessThanOrEqual((arch?.end ?? 0) - 3);
  });

  it("shows every highlight the owner named, each from the real product, as the narration names it", () => {
    const reel = film.CAPTURES.filter((slot) => slot.beat === "highlights");
    const labels = reel.map((slot) => slot.label ?? "").join(" | ");
    for (const feature of [
      "Split matrix rebalances",
      "weight dial",
      "Rate card refuses edits",
      "Two keys",
      "simulated PayPal payouts",
      "six checks",
      "Tap a peso",
      "hear Cebuano",
      "Try to break it",
    ])
      expect(labels).toContain(feature);
    // Five words or fewer, readable in a two-second clip under a caption.
    for (const slot of reel) expect(words(slot.label ?? ""), slot.id).toBeLessThanOrEqual(5);
    // Each clip after the first starts within 0.3 s of the words that name its feature; the first opens the beat.
    const highlights = beat("highlights");
    for (const [index, slot] of reel.entries()) {
      expect(slot.word, slot.id).not.toBeNull();
      const t = said(highlights, slot.word ?? "");
      if (index === 0) {
        expect(slot.start).toBe(highlights.start);
        expect(t - slot.start, slot.id).toBeLessThanOrEqual(1.5);
      } else expect(Math.abs(slot.start - t), slot.id).toBeLessThanOrEqual(0.3);
    }
    // A PayPal moment in the reel: two keys, then the simulated Payouts fan-out.
    expect(reel.find((slot) => slot.id === "hl-keys")?.state).toBe("MM-6 on W-TR-08");
    for (const slot of film.CAPTURES) {
      expect(["console film mode", "phone recording", "Proof in the browser"]).toContain(slot.source);
      expect(slot.shows.length, slot.id).toBeGreaterThan(20);
      if (slot.phase) expect(slot.state, slot.id).toMatch(/^MM-[\dS]+ on /);
    }
    // Card beats are original typography; every other beat is covered end to end by real captures.
    for (const b of film.beats) {
      const slots = film.CAPTURES.filter((slot) => slot.beat === b.id);
      if (b.card) expect(slots, b.id).toEqual([]);
      else
        expect(
          slots.reduce((sum, slot) => sum + slot.duration, 0),
          b.id,
        ).toBeCloseTo(b.end - b.start, 6);
    }
    // The holds cut to the rate card as Analyn tries the deduction.
    const holds = beat("holds");
    const rules = film.CAPTURES.find((slot) => slot.id === "rules-console");
    expect(Math.abs((rules?.start ?? 0) - said(holds, "analyn"))).toBeLessThanOrEqual(0.3);
    // The other take differs only in where the reading beat cuts.
    const standIn = film.capturesForReading("stand-in");
    expect(standIn.map((slot) => slot.id)).toEqual(film.CAPTURES.map((slot) => slot.id));
    for (const slot of standIn.filter((item) => item.beat !== "reading"))
      expect(slot.start, slot.id).toBe(film.CAPTURES.find((item) => item.id === slot.id)?.start);
  });

  it("frames the batch hash both screens share, and never accelerates a person signing", () => {
    for (const id of ["hl-keys", "signing-console", "signing-phone"])
      expect(film.CAPTURES.find((slot) => slot.id === id)?.shows, id).toContain("3f1c 1ce6");
    const phone = film.CAPTURES.find((slot) => slot.id === "signing-phone");
    expect(phone?.source).toBe("phone recording");
    expect(phone?.reference).toBeNull();
    expect(film.CAPTURES.find((slot) => slot.id === "listening-phone")?.state).toContain("M-MB-03");
  });

  it("uses IC-03 figures, the narrowed prior-art line, and no runtime package imports", () => {
    const show = onScreen(film.beats, film.CAPTURES);
    expect(show).toContain(seed.figures.display.invoice);
    expect(show).toContain(seed.figures.display.batchTotal);
    expect(show).toContain(seed.figures.display.proofShare);
    expect(show).toContain(usd(seed.figures.redirectedDuplicateCents));
    expect(show).toContain(usd(seed.rateCard.canonical.rules.cosign.batchOverCents));
    expect(show).toContain(usd(seed.rateCard.canonical.rules.cosign.lineOverCents));
    expect(show).toContain("None we found starts from a handwritten weigh-slip.");
    // Every comparison is scoped to what the 4 Nov scan found.
    expect(beat("impressive").say).toContain(
      "Others we found share parts; none starts from a handwritten weigh-slip.",
    );
    const source = readFileSync(scriptUrl, "utf8");
    expect(source).not.toMatch(/\bothers share\b/i);
    expect(source).not.toMatch(/protect[s]? a payer/i);
    expect(source).not.toMatch(/protects the people being paid/i);
    expect(source.match(/from\s+["'](?!node:)[^"']+["']/g) ?? []).toEqual([]);
  });
});
