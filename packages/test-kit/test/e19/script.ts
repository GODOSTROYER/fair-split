// E-19 film script limits (S5.6.1, word cap amended by ADR-0017): 371 spoken words or fewer, counted as a word
// processor does (a hyphenated word is one), and 140 words a minute or slower in every beat.
//
// video/script.ts (WS-MEDIA, F1) holds each line as `say` (spoken) and `show` (caption). This module reads any
// exported array of beats that carry `say`, timed by `start`/`end` (seconds or "m:ss") or by `time` ("m:ss–m:ss").
// A beat without a readable time fails loudly rather than being skipped.

/**
 * Script v4 (ADR-0017) is a product video: a full overview in the first minute, then the deep dive and the limits,
 * in 2:55. It needs 371 words; the cap is raised that far and no further. The pace limit is unchanged.
 */
export const MAX_WORDS = 371;
export const MAX_WPM = 140;

export interface Beat {
  readonly label: string;
  readonly start: number;
  readonly end: number;
  readonly say: string;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Seconds from 75, "75", "1:15" or "01:15". */
function seconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

const spoken = (say: unknown): string =>
  Array.isArray(say)
    ? say.filter((s) => typeof s === "string").join(" ")
    : typeof say === "string"
      ? say
      : "";

/** The beats in a loaded video/script.ts module; throws when the shape cannot be read. */
export function beatsFrom(mod: Readonly<Record<string, unknown>>): Beat[] {
  const list = Object.values(mod).find(
    (v): v is readonly Record<string, unknown>[] =>
      Array.isArray(v) && v.length > 0 && v.every((b) => b !== null && typeof b === "object" && "say" in b),
  );
  if (!list) throw new Error("video/script.ts exports no array of beats with `say`");
  return list.map((b, i) => {
    const label = typeof b.id === "string" ? b.id : typeof b.beat === "string" ? b.beat : `beat ${i + 1}`;
    let start = seconds(b.start ?? b.from);
    let end = seconds(b.end ?? b.to);
    const range = typeof b.time === "string" ? b.time : typeof b.at === "string" ? b.at : undefined;
    if ((start === undefined || end === undefined) && range) {
      const [a, z] = range.split(/\s*[–—-]\s*/);
      start = seconds(a);
      end = seconds(z);
    }
    if (start === undefined || end === undefined || end <= start) {
      throw new Error(`video/script.ts ${label}: no readable start and end time`);
    }
    return { label, start, end, say: spoken(b.say) };
  });
}

export interface ScriptReport {
  readonly words: number;
  /** One line per broken limit; empty when the script passes. */
  readonly violations: readonly string[];
}

export function checkScript(beats: readonly Beat[]): ScriptReport {
  const violations: string[] = [];
  let words = 0;
  for (const beat of beats) {
    const n = countWords(beat.say);
    words += n;
    const wpm = n / ((beat.end - beat.start) / 60);
    if (wpm > MAX_WPM) {
      violations.push(
        `script-wpm: ${beat.label} runs at ${Math.round(wpm)} wpm (${n} words), over ${MAX_WPM}`,
      );
    }
  }
  if (words > MAX_WORDS) violations.push(`script-words: ${words} spoken words, over ${MAX_WORDS}`);
  return { words, violations };
}
