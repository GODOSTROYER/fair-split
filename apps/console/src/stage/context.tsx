// What the stage offers the screens inside it: its layout, the phone (raise or lower a persona's frame),
// the director (one focal moment at a time), the run pill's next step (to pre-focus its control) and the
// autoplay state "Play it for me" drives (S1.6 `autoplay` and `paused`).

import { createContext, type RefObject, useContext, useEffect } from "react";
import type { NextStep } from "../chrome/next-step.js";
import type { FramePersona } from "../data/adapter.js";
import { focusAndReveal, registerScreenControl } from "../lib/focus.js";
import type { ConsoleScreenId } from "../lib/screens.js";
import type { StageDirector } from "./director.js";
import type { StageLayout } from "./layout.js";

export interface PhoneState {
  /** The frame on show (Member, Chair or Clerk tab). */
  readonly persona: FramePersona;
  /** Docked phone in focus (no scrim), or the tab raised. */
  readonly raised: boolean;
  /**
   * Who raised it (1024–1679 px): a moment leaves the console lit beside the phone, so a screen may make room
   * for it; the viewer's own raise lays the scrim over the console.
   */
  readonly raisedBy?: "user" | "moment" | null;
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
 * pre-focused"). Focus never jumps the page; if the control sits outside its screen's view, the screen scrolls
 * the least it can to show it, so a held key never presses a slab the judge cannot see.
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
    if (!target) return;
    focusAndReveal(target);
    // While it is the step, it is the screen's main control: a focus return with nothing better lands on it.
    return registerScreenControl(target);
  }, [isStep, stepId, when, ref]);
}
