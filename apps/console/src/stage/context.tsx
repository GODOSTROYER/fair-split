// What the stage offers the screens inside it: its layout, the phone (raise or lower a persona's frame),
// the director (one focal moment at a time), the run pill's next step (to pre-focus its control) and the
// autoplay state "Play it for me" drives (S1.6 `autoplay` and `paused`).

import { createContext, type RefObject, useContext, useEffect } from "react";
import type { NextStep } from "../chrome/next-step.js";
import type { FramePersona } from "../data/adapter.js";
import type { ConsoleScreenId } from "../lib/screens.js";
import type { StageDirector } from "./director.js";
import type { StageLayout } from "./layout.js";

export interface PhoneState {
  /** The frame on show (Member, Chair or Clerk tab). */
  readonly persona: FramePersona;
  /** Docked phone in focus (no scrim), or the tab raised. */
  readonly raised: boolean;
  /** Frames whose app answered fs.ready (the development stand-in does not count). */
  readonly ready: Readonly<Record<FramePersona, boolean>>;
}

/** "Play it for me" (W-JG-01, the season slice): off, driving, or paused by the judge's own input. */
export type AutoplayState = "off" | "autoplay" | "paused";

export interface StageApi {
  readonly layout: StageLayout;
  readonly phone: PhoneState;
  /** Shows and raises a persona's frame: a co-sign request raises the Chair (S1.6). */
  raisePhone(persona: FramePersona): void;
  lowerPhone(): void;
  selectPersona(persona: FramePersona): void;
  readonly director: StageDirector;
  readonly next: NextStep;
  readonly autoplay: AutoplayState;
  /** The stage's `data-state` shows `autoplay` or `paused` while this is not "off". */
  setAutoplay(state: AutoplayState): void;
}

export const StageContext = createContext<StageApi | null>(null);

/** The stage around a console screen. Throws outside the stage (Proof, /ops and /sign-in have none). */
export function useStage(): StageApi {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("useStage is only available inside the Judge stage.");
  return stage;
}

/** The stage, or null on surfaces without one. */
export function useOptionalStage(): StageApi | null {
  return useContext(StageContext);
}

/** The run pill's step, so a screen can pre-focus its control. */
export function useNextStep(): NextStep | null {
  return useContext(StageContext)?.next ?? null;
}

/**
 * Focuses `ref` when the run pill's next step is this screen (S1.6: "the control for the step it names is
 * pre-focused"). Scrolls nothing: the step's control is already in view on its screen.
 */
export function usePrefocus(ref: RefObject<HTMLElement | null>, screen: ConsoleScreenId, when = true): void {
  const next = useNextStep();
  const isStep = next?.screen === screen;
  const stepId = next?.id;
  useEffect(() => {
    if (!isStep || !when) return;
    const el = ref.current;
    if (!el) return;
    const target = el.matches("button, a, input, [tabindex]")
      ? el
      : el.querySelector<HTMLElement>(".fs-slab__face, button, a, input, [tabindex]:not([tabindex='-1'])");
    target?.focus({ preventScroll: true });
  }, [isStep, stepId, when, ref]);
}
