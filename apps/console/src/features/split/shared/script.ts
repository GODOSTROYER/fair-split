// A phase script for moments whose visuals belong to primitives (the Slab's hold, the Seal's engraving, the
// dial's needle, the fan's threads): it walks one act of @fairsplit/motion's TIMELINES in the viewer's motion
// mode and enters each phase at its time, playing the act's feedback, so phases, times and sounds still come
// from one file (IC-10) while the drawing stays with the component that owns it.
//
// It exists beside lib/moment's `play()` for two reasons, both reported to the shell: a d2 or d3 Slab already
// plays its own plunk and ticks when pressed (playing the act again would double them), and `play()` cannot pass
// a scale-note index (`item.paid.console` climbs the pentatonic scale, one note per verified item). Evidence is
// still required: no event, no phases.
//
// `usePhaseSync` keeps a moment's phase true to the screen's state when nothing live is playing: history and
// replays set the phase in place (never animated), and a finished act hands back to the state it led to.

import type { FeedbackEvent, MomentId, MomentPhase } from "@fairsplit/motion";
import { stepsFor, TIMELINES } from "@fairsplit/motion";
import { feedback } from "@fairsplit/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MomentController, MomentEvidence } from "../../../lib/moment.js";
import { useOptionalStage } from "../../../stage/context.js";

export interface ScriptOptions {
  /** Feedback the person's own press already made (the Slab plays it): skip it here. */
  readonly skipFeedback?: readonly FeedbackEvent[];
  /** The scale note for `item.paid.console` (0-based; the recipe wraps after 8). */
  readonly feedbackIndex?: number;
  /** Claim the stage's single focal slot (S1.6 director); waits at most 1.6 s, else plays at once. */
  readonly focal?: boolean;
  /** Extra delay before the act starts (item landings spaced 250 ms apart by the director). */
  readonly delayMs?: number;
}

export interface MomentScript<M extends MomentId> {
  /** Runs an act's phases; false when refused (no evidence, the same evidence twice, an unknown act). */
  run(actId: string, evidence: MomentEvidence, options?: ScriptOptions): boolean;
  /** Stops pending steps (a newer event replaces them; events never queue). */
  cancel(): void;
  /** The act's length in this mode, in ms (the last step's time). */
  length(actId: string): number;
  /** The time of the step that enters `phase` in an act, or null. */
  at(actId: string, phase: MomentPhase<M>): number | null;
  /** True while an act's steps are still pending. */
  readonly busy: boolean;
}

export function useMomentScript<M extends MomentId>(moment: MomentController<M>): MomentScript<M> {
  const stage = useOptionalStage();
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const played = useRef(new Set<string>());
  const release = useRef<(() => void) | null>(null);
  const latest = useRef(moment);
  latest.current = moment;
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    release.current?.();
    release.current = null;
    if (mounted.current) setBusy(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
      release.current?.();
      release.current = null;
      // A remount is a new viewing (and StrictMode's rehearsal unmount must not swallow the act it cut short):
      // the same evidence may play again once mounted again.
      played.current.clear();
    };
  }, []);

  const act = useCallback(
    (actId: string) => TIMELINES[latest.current.id].acts.find((a) => a.id === actId),
    [],
  );

  const run = useCallback(
    (actId: string, evidence: MomentEvidence, options: ScriptOptions = {}): boolean => {
      if (!evidence || typeof evidence.eventId !== "string" || evidence.eventId.length === 0) return false;
      const found = act(actId);
      if (!found) return false;
      const key = `${actId}:${evidence.eventId}`;
      if (played.current.has(key)) return false;
      played.current.add(key);
      cancel();
      const mode = latest.current.mode;
      const steps = stepsFor(found, mode);
      const end = steps.reduce((max, s) => Math.max(max, s.at), 0);
      let delay = Math.max(0, options.delayMs ?? 0);
      if (options.focal && stage) {
        const claim = stage.director.claim(latest.current.id, end);
        delay += claim.delayMs;
        release.current = claim.release;
      }
      const skip = new Set(options.skipFeedback ?? []);
      setBusy(true);
      for (const step of steps) {
        const apply = () => {
          if (step.phase) latest.current.enter(step.phase as MomentPhase<M>);
          if (step.feedback && !skip.has(step.feedback)) {
            feedback.play(
              step.feedback,
              options.feedbackIndex === undefined ? {} : { index: options.feedbackIndex },
            );
          }
        };
        const at = delay + step.at;
        if (at <= 0) {
          apply();
          continue;
        }
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          apply();
        }, at);
        timers.current.add(timer);
      }
      const done = setTimeout(() => {
        timers.current.delete(done);
        release.current?.();
        release.current = null;
        if (mounted.current) setBusy(false);
      }, delay + end);
      timers.current.add(done);
      return true;
    },
    [act, cancel, stage],
  );

  const length = useCallback(
    (actId: string) => {
      const found = act(actId);
      if (!found) return 0;
      return stepsFor(found, latest.current.mode).reduce((max, s) => Math.max(max, s.at), 0);
    },
    [act],
  );

  const at = useCallback(
    (actId: string, phase: MomentPhase<M>) => {
      const found = act(actId);
      const step = found ? stepsFor(found, latest.current.mode).find((s) => s.phase === phase) : undefined;
      return step ? step.at : null;
    },
    [act],
  );

  return useMemo(() => ({ run, cancel, length, at, busy }), [run, cancel, length, at, busy]);
}

/**
 * Sets the moment's phase to `target` whenever no act is playing and the phase differs: the state a screen
 * shows from history (or reaches by a replay) is entered in place, with nothing animated. `null` leaves the
 * phase alone (a press in flight owns it).
 */
export function usePhaseSync<M extends MomentId>(
  moment: MomentController<M>,
  target: MomentPhase<M> | null,
  busy: boolean,
): void {
  const { phase, enter } = moment;
  useEffect(() => {
    if (busy || target === null || phase === target) return;
    enter(target);
  }, [busy, target, phase, enter]);
}
