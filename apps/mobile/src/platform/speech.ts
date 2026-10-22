/**
 * Paminawa's device-voice reader (M-MB-03 `device-voice`): reads the statement sentence by sentence so the
 * transcript can underline the one being read. Voice choice and one-off samples are shared (`services/voice.ts`).
 */
import * as Speech from "expo-speech";

export { pickVoiceLanguage as pickLanguage } from "../services/voice";

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
