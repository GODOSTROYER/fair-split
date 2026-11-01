/**
 * Paminawa's device-voice reader (M-MB-03 `device-voice`): the phone's own voice reads one sentence and reports the
 * words it reaches, so the slip chips rise as each serial is named. It is used only where fs-api served no synthetic
 * clip for the sentence (ADR-0011 §6), and the UI always says it is the phone's voice (I8).
 *
 * Phones rarely ship a Cebuano voice, so Cebuano is read with the best Filipino voice (`services/voice.ts` makes the
 * same choice for the first-run samples). When the phone has no voice for the language family at all, `findVoice`
 * says so and Paminawa shows the transcript as text only, rather than reading Cebuano with an English voice.
 *
 * The callbacks of a sentence that was stopped never fire after `stop()`: expo-speech reports a stop as
 * `onStopped`, and a cancelled web utterance can still report an error, so every callback is gated.
 */
import * as Speech from "expo-speech";
import type { Lang } from "../_shims/contracts";
import { chooseVoice, type VoiceChoice } from "../lib/statement";

export type { VoiceChoice } from "../lib/statement";

export interface SpeakHandle {
  stop(): void;
}

/** Web browsers fill their voice list late (and some never do): wait briefly, then decide without it. */
const VOICES_WAIT_MS = 1500;

async function voices(): Promise<Speech.Voice[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Speech.Voice[]>((resolve) => {
    timer = setTimeout(() => resolve([]), VOICES_WAIT_MS);
  });
  try {
    return await Promise.race([Speech.getAvailableVoicesAsync(), timeout]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The voice for `lang` on this phone, or null when it has none for that language family. A phone that lists no
 * voices at all still speaks English, so English is tried by its tag alone; Cebuano and Filipino are never guessed.
 */
export async function findVoice(lang: Lang): Promise<VoiceChoice | null> {
  const list = await voices();
  if (list.length === 0) return lang === "en" ? { language: "en-US", voiceId: null } : null;
  return chooseVoice(lang, list);
}

/** expo-speech passes `{charIndex}` on native and a `SpeechSynthesisEvent` (also with `charIndex`) on the web. */
function charIndexOf(ev: unknown): number | null {
  const v = (ev as { charIndex?: unknown } | null)?.charIndex;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Reads one sentence. `rate` 1 is the voice's normal pace; "Hinay" passes 0.85. */
export function speakStep(
  text: string,
  opts: {
    voice: VoiceChoice;
    rate: number;
    onBoundary?: (charIndex: number) => void;
    onDone: () => void;
  },
): SpeakHandle {
  let live = true;
  const finish = () => {
    if (!live) return;
    live = false;
    opts.onDone();
  };
  Speech.speak(text, {
    language: opts.voice.language,
    ...(opts.voice.voiceId ? { voice: opts.voice.voiceId } : {}),
    rate: opts.rate,
    onBoundary: (ev: unknown) => {
      const at = charIndexOf(ev);
      if (live && at !== null) opts.onBoundary?.(at);
    },
    onDone: finish,
    // A voice that fails on one sentence moves on to the next rather than stalling the transcript.
    onError: finish,
  });
  return {
    stop() {
      if (!live) return;
      live = false;
      void Speech.stop();
    },
  };
}

/** Silences the phone's voice (Paminawa closing, or a clip taking over). */
export function stopSpeaking(): void {
  void Speech.stop();
}
