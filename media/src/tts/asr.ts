/**
 * An automatic listening check for the S10 spike: a different Gemini model transcribes each synthesised
 * request and the transcript is scored against the text that was sent (character error rate). It is a
 * proxy only; pronunciation and naturalness still need a person's listening test (OD-2).
 */

import { MODEL_CHOICE } from "./gemini.js";
import { numberWords, spokenPhp, spokenUsd } from "./spoken.js";

/**
 * The highest-end free-tier text model that takes audio input (pricing page read 1 Nov 2026; the choice
 * and its source are recorded in gemini.ts, MODEL_CHOICE). Requests go through the key pool like TTS.
 */
export const ASR_MODEL = MODEL_CHOICE.asr;
/** Live models.list and free Standard pricing checked 2026-11-01. 3.6 and 2.5 accept audio input.
 * https://ai.google.dev/gemini-api/docs/pricing
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
 * 3.5 Flash is listed but has no current free pricing row; never infer free access from listing alone.
 */
export const ASR_MODELS: readonly string[] = [ASR_MODEL, "gemini-3.6-flash", "gemini-2.5-flash"];
export const isAsrModel = (model: unknown): model is string =>
  typeof model === "string" && ASR_MODELS.includes(model);

export interface GenerateContentClient {
  models: {
    generateContent(params: Record<string, unknown>): Promise<{ text?: string | undefined }>;
  };
}

const LANG_NAMES: Record<string, string> = { ceb: "Cebuano", fil: "Filipino", en: "English" };

export function asrPrompt(lang: string): string {
  const name = LANG_NAMES[lang] ?? lang;
  return `Transcribe this ${name} speech verbatim. Output only the words spoken, with no commentary, no translation and no timestamps. Write numbers as words, exactly as spoken.`;
}

export async function transcribe(
  client: GenerateContentClient,
  wav: Buffer,
  lang: string,
  now: () => number = Date.now,
): Promise<{ text: string; latencyMs: number }> {
  const t0 = now();
  const res = await client.models.generateContent({
    model: ASR_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
          { text: asrPrompt(lang) },
        ],
      },
    ],
  });
  return { text: (res.text ?? "").trim(), latencyMs: now() - t0 };
}

/**
 * Spells out numerals the way the statement says them, because ASR writes "$64.45" and "4,028" even
 * when asked for words (22 Oct: English CER 0.42 before this, all of it numeral formatting).
 */
export function spellNumerals(s: string): string {
  return s
    .replace(/(?:US)?\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/g, (_m, d: string, c?: string) =>
      spokenUsd(Number(d.replace(/,/g, "")) * 100 + Number(c ?? 0)),
    )
    .replace(/₱\s?(\d{1,3}(?:,\d{3})*|\d+)/g, (_m, d: string) => spokenPhp(Number(d.replace(/,/g, ""))))
    .replace(/\d{1,3}(?:,\d{3})+|\d+/g, (d: string, offset: number, source: string) => {
      // Explicit leading zeros identify a digit sequence. Missing zeros are never inferred.
      const spoken = /^0\d+$/.test(d)
        ? [...d].map((digit) => numberWords(Number(digit))).join(" ")
        : numberWords(Number(d.replace(/,/g, "")));
      // Rule identifiers such as R1 contain a separate spoken letter and number.
      const before = /\p{L}/u.test(source[offset - 1] ?? "") ? " " : "";
      const after = /\p{L}/u.test(source[offset + d.length] ?? "") ? " " : "";
      return `${before}${spoken}${after}`;
    });
}

/** Lower case, numerals spelled out, no punctuation or tags, single spaces. */
export function normaliseForCer(s: string): string {
  return (
    spellNumerals(s)
      .replace(/<[^>]+>/g, " ")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // Cebuano's reduplicated compound has both spellings in the independent PAY transcripts.
      // Keep this lexical: joining arbitrary hyphens would change number and slip token boundaries.
      .replace(/\bgibana-bana\b/g, "gibanabana")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Character error rate: Levenshtein distance between normalised strings over the reference length. */
export function cer(reference: string, hypothesis: string): number {
  const a = normaliseForCer(reference);
  const b = normaliseForCer(hypothesis);
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const sub = (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur.push(Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, sub));
    }
    prev = cur;
  }
  return Math.round(((prev[b.length] as number) / a.length) * 1000) / 1000;
}
