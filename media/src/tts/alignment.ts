import { cer, normaliseForCer } from "./asr.js";

/** Conservative publication gate. Timing remains measured even when surrounding words differ. */
export const STATEMENT_CER_LIMIT = 0.12;

const NUMBER_WORDS = new Set(
  (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen " +
    "sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety " +
    "hundred thousand million point"
  ).split(" "),
);

function numberSequence(text: string): string {
  return normaliseForCer(text)
    .split(" ")
    .filter((token) => NUMBER_WORDS.has(token))
    .join(" ");
}

interface Span {
  start: number;
  end: number;
}
interface Word extends Span {
  text: string;
}
interface Anchor {
  start: number;
  spoken: string;
  ref: string;
}

function cell(matrix: number[][], row: number, column: number): number {
  return matrix[row]?.[column] ?? Number.POSITIVE_INFINITY;
}

function put(matrix: number[][], row: number, column: number, value: number): void {
  const target = matrix[row];
  if (!target) throw new Error("Invalid alignment matrix row");
  target[column] = value;
}

/** Read PCM16 RIFF chunks rather than assuming a fixed WAV header. */
function rmsFrames(wav: Buffer): { levels: number[]; step: number; duration: number } | null {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    return null;
  let channels = 0;
  let rate = 0;
  let pcm: Buffer | undefined;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    const begin = at + 8;
    if (begin + size > wav.length) return null;
    const id = wav.toString("ascii", at, at + 4);
    if (id === "fmt ") {
      if (size < 16 || wav.readUInt16LE(begin) !== 1 || wav.readUInt16LE(begin + 14) !== 16) return null;
      channels = wav.readUInt16LE(begin + 2);
      rate = wav.readUInt32LE(begin + 4);
    }
    if (id === "data") pcm = wav.subarray(begin, begin + size);
    at = begin + size + (size % 2);
  }
  if (!pcm || channels < 1 || rate < 1 || pcm.length % (channels * 2)) return null;
  const count = pcm.length / (channels * 2);
  const frame = Math.max(1, Math.round(rate * 0.01));
  const levels: number[] = [];
  for (let from = 0; from < count; from += frame) {
    const end = Math.min(count, from + frame);
    let energy = 0;
    for (let sample = from; sample < end; sample++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = pcm.readInt16LE((sample * channels + channel) * 2) / 32_768;
        energy += value * value;
      }
    }
    levels.push(Math.sqrt(energy / ((end - from) * channels)));
  }
  return { levels, step: frame / rate, duration: count / rate };
}

/**
 * Silence is relative to this take's loudness, with a 120 ms minimum. A duration-weighted global
 * search chooses sentence gaps, retaining shorter natural pauses within sentences. This is only a
 * candidate plan: callers must transcribe and verify every resulting clip before publication.
 */
export function adaptiveCuts(
  wav: Buffer,
  expectedTexts: readonly string[],
): { cuts: Span[]; onsets: number[] } | null {
  const audio = rmsFrames(wav);
  if (!audio || !expectedTexts.length || expectedTexts.some((text) => !normaliseForCer(text))) return null;
  const { levels, step, duration } = audio;
  const sorted = [...levels].sort((a, b) => a - b);
  const high = sorted[Math.floor(sorted.length * 0.8)] ?? 0;
  const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  if (high < 0.00001) return null;
  const floor = Math.min(high * 0.35, Math.max(high * 0.08, low * 1.8));
  const voiced = levels.map((level) => level > floor);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return null;
  const start = first * step;
  const end = Math.min(duration, (last + 1) * step);
  const gaps: Span[] = [];
  for (let i = first; i <= last; i++) {
    if (voiced[i]) continue;
    const begin = i;
    while (i <= last && !voiced[i]) i++;
    if ((i - begin) * step >= 0.12 - 0.000001) gaps.push({ start: begin * step, end: i * step });
  }
  if (gaps.length < expectedTexts.length - 1) return null;
  const speechPrefix = [0];
  for (const speech of voiced) speechPrefix.push((speechPrefix.at(-1) ?? 0) + (speech ? step : 0));
  const speechAt = (time: number) => speechPrefix[Math.min(levels.length, Math.round(time / step))] ?? 0;
  const speechTotal = speechAt(end) - speechAt(start);
  const weights = expectedTexts.map((text) => {
    const normalized = normaliseForCer(text);
    return normalized.length + normalized.split(" ").length * 2;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const points = [{ start, end: start }, ...gaps, { start: end, end }];
  const n = expectedTexts.length;
  const scores = Array.from({ length: n + 1 }, () =>
    Array<number>(points.length).fill(Number.POSITIVE_INFINITY),
  );
  const previous = Array.from({ length: n + 1 }, () => Array<number>(points.length).fill(-1));
  put(scores, 0, 0, 0);
  for (let sentence = 1; sentence <= n; sentence++) {
    const target = (speechTotal * (weights[sentence - 1] ?? 0)) / totalWeight;
    const final = sentence === n;
    for (let right = 1; right < points.length; right++) {
      if (final !== (right === points.length - 1)) continue;
      for (let left = 0; left < right; left++) {
        const before = scores[sentence - 1]?.[left] ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(before)) continue;
        const a = points[left];
        const b = points[right];
        if (!a || !b) continue;
        const actual = speechAt(b.start) - speechAt(a.end);
        const ratio = actual / target;
        if (actual < 0.15 || ratio < 0.35 || ratio > 2.8) continue;
        const gapReward = final ? 0 : Math.min(b.end - b.start, 0.8) * 0.08;
        const score = before + Math.log(ratio) ** 2 - gapReward;
        if (score < (scores[sentence]?.[right] ?? Number.POSITIVE_INFINITY)) {
          put(scores, sentence, right, score);
          put(previous, sentence, right, left);
        }
      }
    }
  }
  let right = points.length - 1;
  if (!Number.isFinite(scores[n]?.[right])) return null;
  const selected: Span[] = [];
  for (let sentence = n; sentence > 0; sentence--) {
    const left = previous[sentence]?.[right] ?? -1;
    const a = points[left];
    const b = points[right];
    if (!a || !b) return null;
    selected.unshift({ start: a.end, end: b.start });
    right = left;
  }
  const round = (time: number) => Math.round(time * 1000) / 1000;
  return {
    cuts: selected.map((span) => ({
      start: round(Math.max(0, span.start - 0.15)),
      end: round(Math.min(duration, span.end + 0.15)),
    })),
    onsets: selected.map((span) => round(span.start)),
  };
}

/**
 * Align normalised word tokens with minimum-edit-distance paths. An anchor is accepted only if every
 * optimal path maps all its tokens to the same contiguous transcript tokens, with whole-anchor CER
 * within the publication limit. Repeated phrases use their reference position; deleted or ambiguous
 * anchors never receive guessed offsets.
 */
export function alignWords(
  words: readonly Word[],
  expected: string,
  duration: number,
  anchors: readonly Anchor[],
): { offsets: { ref: string; at_ms: number }[]; cer: number } | null {
  if (!Number.isFinite(duration) || duration <= 0 || !words.length) return null;
  let end = 0;
  for (const word of words) {
    if (
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < end ||
      word.end <= word.start ||
      word.end > duration ||
      !normaliseForCer(word.text)
    )
      return null;
    end = word.end;
  }
  const error = cer(expected, words.map((word) => word.text).join(" "));
  if (error > STATEMENT_CER_LIMIT) return null;
  const reference = normaliseForCer(expected).split(" ");
  const transcript = words.flatMap((word) =>
    normaliseForCer(word.text)
      .split(" ")
      .map((text) => ({ text, start: word.start })),
  );
  const n = reference.length;
  const m = transcript.length;
  const forward = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  const backward = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) put(forward, i, 0, i);
  for (let j = 0; j <= m; j++) put(forward, 0, j, j);
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      put(
        forward,
        i,
        j,
        Math.min(
          cell(forward, i - 1, j) + 1,
          cell(forward, i, j - 1) + 1,
          cell(forward, i - 1, j - 1) + (reference[i - 1] === transcript[j - 1]?.text ? 0 : 1),
        ),
      );
    }
  for (let i = n; i >= 0; i--) put(backward, i, m, n - i);
  for (let j = m; j >= 0; j--) put(backward, n, j, m - j);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      put(
        backward,
        i,
        j,
        Math.min(
          cell(backward, i + 1, j) + 1,
          cell(backward, i, j + 1) + 1,
          cell(backward, i + 1, j + 1) + (reference[i] === transcript[j]?.text ? 0 : 1),
        ),
      );
    }
  const cost = cell(forward, n, m);
  const offsets: { ref: string; at_ms: number }[] = [];
  for (const anchor of anchors) {
    if (!Number.isInteger(anchor.start) || anchor.start < 0 || !anchor.ref || !normaliseForCer(anchor.spoken))
      return null;
    if (
      normaliseForCer(expected.slice(anchor.start, anchor.start + anchor.spoken.length)) !==
      normaliseForCer(anchor.spoken)
    )
      return null;
    // A source character index must begin a token, never a substring inside a word.
    if (anchor.start > 0 && /[\p{L}\p{N}]/u.test(expected[anchor.start - 1] ?? "")) return null;
    const prefix = normaliseForCer(expected.slice(0, anchor.start));
    const from = prefix ? prefix.split(" ").length : 0;
    const tokens = normaliseForCer(anchor.spoken).split(" ");
    let firstMatch = -1;
    for (let k = 0; k < tokens.length; k++) {
      const i = from + k;
      if (reference[i] !== tokens[k]) return null;
      const matches: number[] = [];
      for (let j = 0; j <= m; j++) {
        if (cell(forward, i, j) + 1 + cell(backward, i + 1, j) === cost) return null;
        if (j === m) continue;
        const same = reference[i] === transcript[j]?.text;
        if (cell(forward, i, j) + (same ? 0 : 1) + cell(backward, i + 1, j + 1) !== cost) continue;
        matches.push(j);
      }
      if (matches.length !== 1) return null;
      const match = matches[0] ?? -1;
      if (k === 0) firstMatch = match;
      else if (match !== firstMatch + k) return null;
    }
    const phrase = transcript
      .slice(firstMatch, firstMatch + tokens.length)
      .map((token) => token.text)
      .join(" ");
    if (cer(anchor.spoken, phrase) > STATEMENT_CER_LIMIT) return null;
    // CER tolerates spelling, but a nearby number is a different payroll fact. Digits have already
    // been spelled by normaliseForCer; compare their number-word sequence without fuzzy matching.
    if (numberSequence(anchor.spoken) !== numberSequence(phrase)) return null;
    // Spelled initials identify the capital rule. A long label's low CER must not excuse C B V/X.
    if (/\bc b u\b/.test(normaliseForCer(anchor.spoken)) && !/\bc b u\b/.test(phrase)) return null;
    const measured = transcript[firstMatch];
    if (!measured) return null;
    const atMs = Math.round(measured.start * 1000);
    if (atMs >= duration * 1000) return null;
    offsets.push({ ref: anchor.ref, at_ms: atMs });
  }
  return { offsets, cer: error };
}
