// useMoment(id): the one phase machine every console moment runs on (S2.8). It plays the acts of
// @fairsplit/motion's TIMELINES in the viewer's motion mode, so phases, times and feedback come from one
// file (IC-10, frozen 27 Oct), never from screen code. It writes data-moment and data-moment-phase through
// `rootProps`, appends {m, phase, t} to window.__fsMoments in test builds or with ?fsTrace=1, and refuses
// to start without evidence: motion is evidence, so every act needs the event that caused it (an SSE
// RunEvent ID, an HTTP response, a signature, or the person's own press). The same evidence twice plays once.

import {
  type FeedbackEvent,
  MOMENTS,
  type MomentId,
  type MomentPhase,
  type MotionMode,
  type MotionRef,
  motionMs,
  type Step,
  stepsFor,
  TIMELINES,
} from "@fairsplit/motion";
import { spring, timed, tween } from "@fairsplit/motion/web";
import { feedback, useMotionMode } from "@fairsplit/ui-web";
import { type AnimationPlaybackControls, animate, type MotionValue, motionValue } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StageDirector } from "../stage/director.js";

export interface MomentEvidence {
  /** The RunEvent ID, the response's request ID, the approval ID, or a local press ID. Never empty. */
  readonly eventId: string;
  readonly kind?: "sse" | "http" | "signature" | "press";
}

/**
 * How one act plays. A d2 or d3 Slab plays its own plunk and ticks when pressed, so an act started by that press
 * skips them instead of sounding twice; `item.paid.console` climbs the pentatonic scale, one note per verified
 * item, so the act names its note.
 */
export interface PlayOptions {
  /** Feedback the person's own press already made (the Slab played it): never played again by the act. */
  readonly skipFeedback?: readonly FeedbackEvent[];
  /** The scale note for `item.paid.console` (0-based; the recipe wraps after 8). */
  readonly feedbackIndex?: number;
}

export interface MomentOptions {
  /** Claims the stage's focus (S1.6 stage director): waits up to 1.6 s, else plays reduced. */
  readonly focal?: boolean;
  /** Forces a renderer (galleries, tests). Defaults to the surface's motion mode. */
  readonly mode?: MotionMode;
}

export interface MomentController<M extends MomentId> {
  readonly id: M;
  readonly phase: MomentPhase<M>;
  readonly mode: MotionMode;
  readonly playing: boolean;
  /** An animated target from the moment's timeline (`TIMELINES[id].initial`), e.g. value("arc"). */
  value(target: string): MotionValue<number>;
  /** Plays one act of the timeline. Returns false when refused (no evidence, a repeat, an unknown act). */
  play(actId: string, evidence: MomentEvidence, options?: PlayOptions): boolean;
  /** Moves to a phase that no act drives (MM-5 "blocked" while holds are open). */
  enter(phase: MomentPhase<M>): void;
  /** Back to the first phase and the initial values. */
  reset(): void;
  readonly rootProps: { readonly "data-moment": M; readonly "data-moment-phase": MomentPhase<M> };
}

declare global {
  interface Window {
    __fsMoments?: { m: string; phase: string; t: number }[];
  }
}

const DirectorContext = createContext<StageDirector | null>(null);
export const DirectorProvider = DirectorContext.Provider;

function tracing(): boolean {
  if (import.meta.env.MODE === "test") return true;
  try {
    return new URLSearchParams(window.location.search).get("fsTrace") === "1";
  } catch {
    return false;
  }
}

export function traceMoment(id: string, phase: string): void {
  if (typeof window === "undefined" || !tracing()) return;
  window.__fsMoments ??= [];
  window.__fsMoments.push({ m: id, phase, t: performance.now() });
}

function transitionOf(motion: Exclude<MotionRef, { readonly instant: true }>) {
  if ("tween" in motion) return tween(motion.tween);
  if ("spring" in motion) return spring(motion.spring, "unitless");
  return timed(motion.ms, motion.ease);
}

/** Total length of an act's steps in a mode, for the director's focal claim. */
export function actLength<M extends MomentId>(steps: readonly Step<M>[]): number {
  let end = 0;
  for (const step of steps) end = Math.max(end, step.at + motionMs(step.motion));
  return end;
}

export function useMoment<M extends MomentId>(id: M, options: MomentOptions = {}): MomentController<M> {
  const surfaceMode = useMotionMode();
  const mode: MotionMode = options.mode ?? surfaceMode;
  const director = useContext(DirectorContext);
  const first = MOMENTS[id][0] as MomentPhase<M>;
  const [phase, setPhaseState] = useState<MomentPhase<M>>(first);
  const [playing, setPlaying] = useState(false);
  const values = useRef(new Map<string, MotionValue<number>>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const animations = useRef(new Set<AnimationPlaybackControls>());
  const played = useRef(new Set<string>());
  const release = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  const setPhase = useCallback(
    (next: MomentPhase<M>) => {
      if (!mounted.current) return;
      setPhaseState(next);
      traceMoment(id, next);
    },
    [id],
  );

  const value = useCallback(
    (target: string): MotionValue<number> => {
      let mv = values.current.get(target);
      if (!mv) {
        mv = motionValue(TIMELINES[id].initial[target] ?? 0);
        values.current.set(target, mv);
      }
      return mv;
    },
    [id],
  );

  const cancel = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    release.current?.();
    release.current = null;
  }, []);

  const apply = useCallback(
    (step: Step<M>, sound: PlayOptions = {}) => {
      if (step.phase) setPhase(step.phase);
      if (step.target !== undefined && step.to !== undefined) {
        const mv = value(step.target);
        if (step.from !== undefined) mv.jump(step.from);
        if (!step.motion || "instant" in step.motion) mv.jump(step.to);
        else {
          const controls = animate(mv, step.to, transitionOf(step.motion));
          animations.current.add(controls);
          void controls.finished.then(() => animations.current.delete(controls));
        }
      }
      if (step.feedback && !sound.skipFeedback?.includes(step.feedback)) {
        feedback.play(step.feedback, sound.feedbackIndex === undefined ? {} : { index: sound.feedbackIndex });
      }
    },
    [setPhase, value],
  );

  const play = useCallback(
    (actId: string, evidence: MomentEvidence, sound: PlayOptions = {}): boolean => {
      if (!evidence || typeof evidence.eventId !== "string" || evidence.eventId.length === 0) {
        if (import.meta.env.DEV)
          console.warn(`${id} refused "${actId}": a moment needs the event that caused it.`);
        return false;
      }
      const key = `${actId}:${evidence.eventId}`;
      if (played.current.has(key)) return false;
      const act = TIMELINES[id].acts.find((a) => a.id === actId);
      if (!act) {
        if (import.meta.env.DEV) console.warn(`${id} has no act "${actId}".`);
        return false;
      }
      played.current.add(key);
      cancel(); // a newer event replaces the target; events never queue
      let actMode = mode;
      let delay = 0;
      if (options.focal && director) {
        const claim = director.claim(id, actLength(stepsFor(act, mode)));
        if (claim.mode === "reduced") actMode = "reduced";
        delay = claim.delayMs;
        release.current = claim.release;
      }
      const steps = stepsFor(act, actMode);
      setPlaying(true);
      const end = Math.max(0, ...steps.map((s) => s.at));
      for (const step of steps) {
        const at = delay + step.at;
        if (at === 0) {
          apply(step, sound);
          continue;
        }
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          apply(step, sound);
        }, at);
        timers.current.add(timer);
      }
      const done = setTimeout(() => {
        timers.current.delete(done);
        if (mounted.current) setPlaying(false);
        release.current?.();
        release.current = null;
      }, delay + end);
      timers.current.add(done);
      return true;
    },
    [apply, cancel, director, id, mode, options.focal],
  );

  const enter = useCallback((next: MomentPhase<M>) => setPhase(next), [setPhase]);

  const reset = useCallback(() => {
    cancel();
    for (const controls of animations.current) controls.stop();
    animations.current.clear();
    for (const [target, mv] of values.current) mv.jump(TIMELINES[id].initial[target] ?? 0);
    setPlaying(false);
    setPhase(first);
  }, [cancel, first, id, setPhase]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
      for (const controls of animations.current) controls.stop();
      animations.current.clear();
    };
  }, [cancel]);

  return useMemo(
    () => ({
      id,
      phase,
      mode,
      playing,
      value,
      play,
      enter,
      reset,
      rootProps: { "data-moment": id, "data-moment-phase": phase },
    }),
    [enter, id, mode, phase, play, playing, reset, value],
  );
}
