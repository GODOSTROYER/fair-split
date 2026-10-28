/**
 * The phone's own voice (expo-speech): the labelled fallback whenever a synthetic Gemini clip is missing (register §9
 * Audio; M-MB-03 `device-voice`) and the language samples at first run. Phones rarely ship a Cebuano voice, so
 * Cebuano is read with the best Filipino voice, and the UI always says it is the phone's own voice (I8).
 */
import * as Speech from "expo-speech";
import type { Lang } from "../_shims/contracts";

const PREFERRED: Readonly<Record<Lang, readonly string[]>> = {
  ceb: ["ceb", "fil-PH", "fil", "tl-PH", "tl"],
  fil: ["fil-PH", "fil", "tl-PH", "tl"],
  en: ["en-PH", "en-US", "en-GB", "en"],
};

let voices: Speech.Voice[] | null = null;

/** The best installed voice language for a statement language (BCP 47 tag). */
export async function pickVoiceLanguage(lang: Lang): Promise<string> {
  try {
    voices ??= await Speech.getAvailableVoicesAsync();
  } catch {
    voices = [];
  }
  const tags = new Set((voices ?? []).map((v) => v.language.replace("_", "-")));
  for (const want of PREFERRED[lang]) {
    if (tags.has(want)) return want;
    const prefix = [...tags].find((t) => t.toLowerCase().startsWith(`${want.toLowerCase()}-`));
    if (prefix) return prefix;
  }
  return PREFERRED[lang][1] ?? "en-US";
}

/** True when the phone has no voice for this language family, so the UI can say "text only". */
export async function hasVoiceFor(lang: Lang): Promise<boolean> {
  const tag = await pickVoiceLanguage(lang);
  return (voices ?? []).some((v) => v.language.replace("_", "-").toLowerCase().startsWith(tag.toLowerCase()));
}

/** Speaks one short text (a first-run sample), interrupting anything already speaking. */
export function speakOnce(text: string, language: string, rate = 0.95): void {
  void Speech.stop().finally(() => Speech.speak(text, { language, rate }));
}

export function stopVoice(): void {
  void Speech.stop();
}
