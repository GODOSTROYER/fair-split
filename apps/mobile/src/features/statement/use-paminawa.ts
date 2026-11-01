/**
 * Runs Paminawa's machine (`paminawa-machine.ts`): each sentence plays through expo-audio the synthetic clip fs-api
 * served for that very sentence (`audioPlan`, ADR-0011 §6), otherwise the phone's own voice reads it (labelled). "Hinay" changes a clip's
 * rate live (`setPlaybackRate(0.85)`) and restarts a phone-voice sentence at the new pace. While the sheet is open
 * Paminawa owns the audio session: product sounds stay silent (`feedback.narration`), and a clip takes the lock
 * screen (`doNotMix`, S2.10).
 */
import { type AudioStatus, setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Lang } from "../../_shims/contracts";
import type { AudioPlan } from "../../lib/statement";
import { feedback } from "../../platform/feedback";
import {
  findVoice,
  type SpeakHandle,
  speakStep,
  stopSpeaking,
  type VoiceChoice,
} from "../../platform/speech";
import {
  PAMINAWA_START,
  type PaminawaEvent,
  type PaminawaState,
  paminawaReducer,
  playbackPlanKey,
} from "./paminawa-machine";

/** Status updates from a clip, often enough for a chip to rise within a word of its mention. */
const CLIP_UPDATE_MS = 100;

/** The phone's voice for a language: `undefined` while the phone is asked, then a voice or null (none). */
export function usePhoneVoice(lang: Lang): VoiceChoice | null | undefined {
  const [voice, setVoice] = useState<{ lang: Lang; choice: VoiceChoice | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void findVoice(lang).then((choice) => {
      if (alive) setVoice({ lang, choice });
    });
    return () => {
      alive = false;
    };
  }, [lang]);
  return voice && voice.lang === lang ? voice.choice : undefined;
}

export function usePaminawa(
  plan: AudioPlan,
  opts: { voice: VoiceChoice | null | undefined; lockTitle: string; lockArtist: string },
) {
  const planRef = useRef(plan);
  planRef.current = plan;
  const [state, send] = useReducer(
    (s: PaminawaState, e: PaminawaEvent) => paminawaReducer(s, e, planRef.current),
    PAMINAWA_START,
  );
  const player = useAudioPlayer(null, { updateInterval: CLIP_UPDATE_MS });
  const speech = useRef<SpeakHandle | null>(null);
  /** The token of the clip now in the player, and whether it has been heard playing (stale finishes are ignored). */
  const clip = useRef<{ token: number; heard: boolean } | null>(null);
  const lockScreen = useRef(false);
  const voiceRef = useRef(opts.voice);
  voiceRef.current = opts.voice;

  // A new language or a different set of clips starts again from the top.
  const planKey = useMemo(() => playbackPlanKey(plan), [plan]);
  useEffect(() => {
    send({ type: "reset" });
  }, [planKey]);

  // Paminawa owns the audio session while it is open: no product sound under the voice.
  useEffect(() => {
    feedback.narration(true);
    return () => {
      feedback.narration(false);
      speech.current?.stop();
      stopSpeaking();
      try {
        player.pause();
        if (lockScreen.current) player.clearLockScreenControls();
      } catch {
        // the player may already be released
      }
    };
  }, [player]);

  // A clip reports its time (the cues) and its end.
  useEffect(() => {
    const sub = player.addListener("playbackStatusUpdate", (st: AudioStatus) => {
      const c = clip.current;
      if (!c) return;
      if (st.playing) c.heard = true;
      if (st.didJustFinish && c.heard) {
        clip.current = null;
        send({ type: "ended", token: c.token });
        return;
      }
      if (st.playing) send({ type: "progress", token: c.token, ms: st.currentTime * 1000 });
    });
    return () => sub.remove();
  }, [player]);

  // Perform the sentence the machine is on.
  useEffect(() => {
    speech.current?.stop();
    speech.current = null;
    if (state.status !== "playing") {
      clip.current = null;
      try {
        player.pause();
      } catch {
        // nothing is loaded yet
      }
      return;
    }
    const step = planRef.current.steps[state.index];
    const token = state.token;
    if (!step) return;
    if (step.voice.kind === "clip") {
      clip.current = { token, heard: false };
      void setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        shouldPlayInBackground: true,
      }).catch(() => {});
      try {
        player.replace({ uri: step.voice.url });
        player.setPlaybackRate(state.rate);
        player.play();
        if (!lockScreen.current) {
          player.setActiveForLockScreen(true, { title: opts.lockTitle, artist: opts.lockArtist });
          lockScreen.current = true;
        }
      } catch {
        clip.current = null;
        send({ type: "ended", token });
        return;
      }
      send({ type: "progress", token, ms: 0 });
      return;
    }
    const voice = voiceRef.current;
    if (step.voice.kind === "device" && voice) {
      try {
        player.pause();
      } catch {
        // nothing is loaded
      }
      speech.current = speakStep(step.spoken, {
        voice,
        rate: state.rate,
        onBoundary: (charIndex) => send({ type: "progress", token, charIndex }),
        onDone: () => send({ type: "ended", token }),
      });
      return;
    }
    send({ type: "ended", token });
    // Only a new token starts a sentence; the plan and rate are read as they stand at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.token]);

  // "Hinay": live on a clip, from the start of the sentence on the phone's voice.
  const rate = useRef(state.rate);
  useEffect(() => {
    if (rate.current === state.rate) return;
    rate.current = state.rate;
    if (state.status !== "playing") return;
    if (planRef.current.steps[state.index]?.voice.kind === "clip") {
      try {
        player.setPlaybackRate(state.rate);
      } catch {
        // applies from the next sentence
      }
    } else {
      send({ type: "restart" });
    }
  }, [state.rate, state.status, state.index, player]);

  const play = useCallback((from?: number) => send({ type: "play", from }), []);
  const pause = useCallback(() => send({ type: "pause" }), []);
  const slow = useCallback((on: boolean) => send({ type: "slow", on }), []);

  return { state, play, pause, slow, send };
}
