/**
 * Device text-to-speech, the labelled fallback when a Gemini clip is missing (register §9 Audio, M-MB-03
 * `device-voice`). Phones rarely have a Cebuano voice, so Cebuano text is read with the best Filipino voice and
 * the UI says it is the phone's own voice.
 */
import * as Speech from "expo-speech";
import type { Lang } from "../_shims/contracts";

const PREFERRED: Readonly<Record<Lang, readonly string[]>> = {
  ceb: ["ceb", "fil-PH", "fil", "tl-PH", "tl"],
  fil: ["fil-PH", "fil", "tl-PH", "tl"],
  en: ["en-PH", "en-US", "en-GB", "en"],
};

let voices: Speech.Voice[] | null = null;

export async function pickLanguage(lang: Lang): Promise<string> {
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

export interface SpeakHandle {
  stop(): void;
}

/** Speaks sentences one by one so the transcript can underline the one being read. */
export function speakSequence(
  sentences: readonly string[],
  opts: {
    language: string;
    rate: number;
    startAt?: number;
    onSentence: (index: number) => void;
    onDone: () => void;
  },
): SpeakHandle {
  let stopped = false;
  const sayFrom = (i: number) => {
    if (stopped) return;
    if (i >= sentences.length) {
      opts.onDone();
      return;
    }
    opts.onSentence(i);
    Speech.speak(sentences[i] ?? "", {
      language: opts.language,
      rate: opts.rate,
      onDone: () => sayFrom(i + 1),
      onStopped: () => {},
      onError: () => sayFrom(i + 1),
    });
  };
  sayFrom(opts.startAt ?? 0);
  return {
    stop() {
      stopped = true;
      void Speech.stop();
    },
  };
}

export function speakOnce(text: string, language: string): void {
  void Speech.stop().finally(() => Speech.speak(text, { language, rate: 0.95 }));
}
