/**
 * An automatic listening check for the S10 spike: a different Gemini model transcribes each synthesised
 * request and the transcript is scored against the text that was sent (character error rate). It is a
 * proxy only; pronunciation and naturalness still need a person's listening test (OD-2).
 */

import { numberWords, spokenPhp, spokenUsd } from "./spoken.js";

export const ASR_MODEL = "gemini-3.8-flash";

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
    .replace(/\d{1,3}(?:,\d{3})+|\d+/g, (d) => numberWords(Number(d.replace(/,/g, ""))));
}

/** Lower case, numerals spelled out, no punctuation or tags, single spaces. */
export function normaliseForCer(s: string): string {
  return spellNumerals(s)
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
