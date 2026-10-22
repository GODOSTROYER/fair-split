// poseAt(moment, t): evaluates a moment's timeline at any instant with the closed-form spring solution, so a
// motion study can render any frame statically (S2 §2.12: `/prototype/moments/MM-5?t=1600`). The renderer
// draws from `values`; tests and Playwright read `phase`.

import { cubicBezier, springResponse } from "./curves.js";
import type { FeedbackEvent } from "./feedback-map.js";
import { MOMENTS, type MomentId, type MomentPhase } from "./moments.js";
import { EASE, TWEENS } from "./presets.js";
import { type MotionMode, type MotionRef, type Step, stepsFor, TIMELINES } from "./timelines.js";

/** Places one act of a timeline on the study's time axis. */
export interface Cue {
  readonly act: string;
  readonly at: number;
  /** Steps of this act scheduled after this absolute time never run (an early release cancels the hold). */
  readonly cancelAt?: number;
}

export interface Study<M extends MomentId = MomentId> {
  readonly moment: M;
  readonly title: string;
  readonly duration: number;
  readonly cues: readonly Cue[];
  /** The event times are illustrative: in the product each act starts on its real event. */
  readonly note: string;
}

export const STUDIES = {
  "MM-1": {
    moment: "MM-1",
    title: "Bayad na",
    duration: 2000,
    cues: [{ act: "paid", at: 300 }],
    note: "The verified SUCCEEDED for M-014 arrives at 300 ms.",
  },
  "MM-5": {
    moment: "MM-5",
    title: "Two keys",
    duration: 7600,
    cues: [
      { act: "rise", at: 300 },
      { act: "hold-1", at: 1500 },
      { act: "signed-1", at: 3200 },
      { act: "hold-2", at: 4600 },
      { act: "signed-2", at: 6100 },
    ],
    note: "H1 resolves at 300 ms. Analyn holds from 1.5 s; her signature is accepted at 3.2 s. Ernesto holds on his phone from 4.6 s; his signature is accepted at 6.1 s.",
  },
  "MM-5-early": {
    moment: "MM-5",
    title: "Two keys: released early",
    duration: 2800,
    cues: [
      { act: "rise", at: 0 },
      { act: "hold-1", at: 900, cancelAt: 1800 },
      { act: "released-early", at: 1800 },
    ],
    note: "Analyn lets go at 900 ms of a 1,600 ms hold. Nothing is signed.",
  },
} as const satisfies Record<string, Study>;

export type StudyId = keyof typeof STUDIES;

export interface Pose<M extends MomentId = MomentId> {
  readonly t: number;
  readonly phase: MomentPhase<M>;
  readonly values: Readonly<Record<string, number>>;
  /** Feedback events fired up to t, in order. */
  readonly fired: readonly { readonly at: number; readonly event: FeedbackEvent }[];
}

interface Placed {
  readonly abs: number;
  readonly order: number;
  readonly step: Step;
}

function place<M extends MomentId>(moment: M, cues: readonly Cue[], mode: MotionMode): Placed[] {
  const acts = TIMELINES[moment].acts;
  const placed: Placed[] = [];
  let order = 0;
  for (const cue of cues) {
    const act = acts.find((a) => a.id === cue.act);
    if (!act) throw new Error(`${moment} has no act "${cue.act}"`);
    for (const step of stepsFor(act as never, mode) as readonly Step[]) {
      const abs = cue.at + step.at;
      if (cue.cancelAt !== undefined && abs >= cue.cancelAt) continue;
      placed.push({ abs, order: order++, step });
    }
  }
  return placed.sort((a, b) => a.abs - b.abs || a.order - b.order);
}

export function progressOf(motion: MotionRef | undefined, dt: number): number {
  if (dt <= 0) return 0;
  if (!motion || "instant" in motion) return 1;
  if ("spring" in motion) return springResponse(motion.spring, dt);
  const ms = "tween" in motion ? TWEENS[motion.tween].ms : motion.ms;
  const easeName = "tween" in motion ? TWEENS[motion.tween].ease : motion.ease;
  return cubicBezier(EASE[easeName], Math.min(1, dt / ms));
}

/** Evaluates a moment at time t (ms) for a set of cues, in a motion mode. */
export function poseAt<M extends MomentId>(
  moment: M,
  t: number,
  cues: readonly Cue[],
  mode: MotionMode = "full",
): Pose<M> {
  const timeline = TIMELINES[moment];
  const placed = place(moment, cues, mode);
  let phase = MOMENTS[moment][0] as MomentPhase<M>;
  const fired: { at: number; event: FeedbackEvent }[] = [];
  const segments = new Map<string, { from: number; to: number; at: number; motion?: MotionRef }>();
  const valueAt = (target: string, time: number): number => {
    const seg = segments.get(target);
    if (!seg) return timeline.initial[target] ?? 0;
    return seg.from + (seg.to - seg.from) * progressOf(seg.motion, time - seg.at);
  };
  for (const { abs, step } of placed) {
    if (abs > t) break;
    if (step.phase) phase = step.phase as MomentPhase<M>;
    if (step.feedback) fired.push({ at: abs, event: step.feedback });
    if (step.target !== undefined && step.to !== undefined) {
      const from = step.from ?? valueAt(step.target, abs);
      segments.set(step.target, { from, to: step.to, at: abs, motion: step.motion });
    }
  }
  const values: Record<string, number> = {};
  for (const target of Object.keys(timeline.initial)) values[target] = valueAt(target, t);
  for (const target of segments.keys()) values[target] = valueAt(target, t);
  return { t, phase, values, fired };
}

/** Evaluates one of the named G1 studies. */
export function poseOfStudy(id: StudyId, t: number, mode: MotionMode = "full"): Pose {
  const study = STUDIES[id];
  return poseAt(study.moment, t, study.cues, mode) as Pose;
}

/** Phase entry times for a set of cues: what Playwright asserts on `data-moment-phase`. */
export function phaseTimes<M extends MomentId>(
  moment: M,
  cues: readonly Cue[],
  mode: MotionMode = "full",
): { readonly phase: MomentPhase<M>; readonly at: number }[] {
  return place(moment, cues, mode)
    .filter((p) => p.step.phase !== undefined)
    .map((p) => ({ phase: p.step.phase as MomentPhase<M>, at: p.abs }));
}
