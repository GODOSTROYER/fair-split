/**
 * Paminawa's player as a pure state machine (M-MB-03; tested in Node). The hook `use-paminawa.ts` performs the
 * effects: it starts the clip or the phone's voice for `index` whenever `token` changes while `playing`, and reports
 * back `ended` and `progress` with the token it was started with, so a late callback from a sentence that was
 * paused, skipped or restarted can never move the transcript.
 *
 * - One sentence at a time; the transcript underlines `index`.
 * - A sentence with no voice (no clip, and no voice on this phone) is skipped; if none can be voiced the transcript
 *   is the statement ("text-only") and play does nothing.
 * - "Hinay" plays at 0.85× (S1.9); the slip a sentence names lights its chip once, in order (`lit`).
 */
import type { ScreenStateOf } from "../../_shims/contracts";
import {
  type AudioMode,
  type AudioPlan,
  clipCuesReached,
  cuesReached,
  type MentionCue,
} from "../../lib/statement";

/** "Hinay": 0.85× (S1.9, design §8 Audio). */
export const SLOW_RATE = 0.85;

/** The same IDs can carry different server text after a refresh or a language change. */
export function playbackPlanKey(plan: AudioPlan): string {
  return JSON.stringify(
    plan.steps.map((s) => [s.id, s.spoken, s.voice.kind === "clip" ? s.voice.url : s.voice.kind]),
  );
}

export interface PaminawaState {
  status: "idle" | "playing" | "paused" | "ended";
  /** The sentence on screen and in the voice. */
  index: number;
  rate: number;
  /** Bumps on every start, pause or restart: callbacks carry the token they were started with. */
  token: number;
  /** Cues of the current sentence already fired. */
  fired: number;
  /** Serial → the stamp of its latest naming; a new stamp lifts the chip again. */
  lit: Readonly<Record<string, number>>;
  stamp: number;
}

export const PAMINAWA_START: PaminawaState = {
  status: "idle",
  index: 0,
  rate: 1,
  token: 0,
  fired: 0,
  lit: {},
  stamp: 0,
};

export type PaminawaEvent =
  /** Play from `from`, or resume where it stopped (from the top once it ended). */
  | { type: "play"; from?: number }
  | { type: "pause" }
  /** Start the current sentence again (the rate changed under the phone's voice). */
  | { type: "restart" }
  | { type: "ended"; token: number }
  | { type: "progress"; token: number; charIndex?: number; ms?: number }
  | { type: "slow"; on: boolean }
  /** The language or the plan changed: back to the top, keeping "Hinay". */
  | { type: "reset" };

function voiced(plan: AudioPlan, i: number): boolean {
  const s = plan.steps[i];
  return !!s && s.voice.kind !== "none";
}

function nextVoiced(plan: AudioPlan, from: number): number | null {
  for (let i = Math.max(0, from); i < plan.steps.length; i++) if (voiced(plan, i)) return i;
  return null;
}

function light(s: PaminawaState, cues: readonly MentionCue[]): PaminawaState {
  if (!cues.length) return s;
  const lit = { ...s.lit };
  let stamp = s.stamp;
  for (const c of cues) lit[c.serial] = ++stamp;
  return { ...s, lit, stamp, fired: s.fired + cues.length };
}

export function paminawaReducer(s: PaminawaState, e: PaminawaEvent, plan: AudioPlan): PaminawaState {
  switch (e.type) {
    case "play": {
      const from = e.from ?? (s.status === "ended" ? 0 : s.index);
      const i = nextVoiced(plan, from);
      if (i === null) return s;
      return { ...s, status: "playing", index: i, token: s.token + 1, fired: 0 };
    }
    case "pause":
      return s.status === "playing" ? { ...s, status: "paused", token: s.token + 1 } : s;
    case "restart":
      return s.status === "playing" ? { ...s, token: s.token + 1, fired: 0 } : s;
    case "progress": {
      if (e.token !== s.token || s.status !== "playing") return s;
      const cues = plan.steps[s.index]?.cues ?? [];
      const due =
        e.ms !== undefined
          ? clipCuesReached(cues, e.ms, s.fired)
          : e.charIndex !== undefined
            ? cuesReached(cues, e.charIndex, s.fired)
            : [];
      return light(s, due);
    }
    case "ended": {
      if (e.token !== s.token || s.status !== "playing") return s;
      // Whatever the voice named but never reported (an engine without word boundaries) still lights, in order.
      const done = light(s, (plan.steps[s.index]?.cues ?? []).slice(s.fired));
      const next = nextVoiced(plan, s.index + 1);
      if (next === null) return { ...done, status: "ended", token: s.token + 1, fired: 0 };
      return { ...done, index: next, token: s.token + 1, fired: 0 };
    }
    case "slow":
      return { ...s, rate: e.on ? SLOW_RATE : 1 };
    case "reset":
      return { ...PAMINAWA_START, rate: s.rate, token: s.token + 1 };
  }
}

/** True when this plan can play anything at all. */
export function canPlay(plan: AudioPlan): boolean {
  return nextVoiced(plan, 0) !== null;
}

/**
 * `data-state` of M-MB-03 (IC-01): `playing` while a voice reads; at rest, how it would read: the synthetic voice
 * (`paused`), the phone's own voice (`device-voice`), Filipino audio under Cebuano text (`filipino-audio`), no
 * voice at all (`text-only`), or `offline` while the phone has no signal and reads the last copy.
 */
export function paminawaScreenState(o: {
  loaded: boolean;
  status: PaminawaState["status"];
  mode: AudioMode;
  online: boolean;
}): ScreenStateOf<"M-MB-03"> {
  if (!o.loaded) return "loading";
  if (o.status === "playing") return "playing";
  if (!o.online) return "offline";
  if (o.mode === "text-only") return "text-only";
  if (o.mode === "device-voice") return "device-voice";
  if (o.mode === "filipino-audio") return "filipino-audio";
  return "paused";
}
