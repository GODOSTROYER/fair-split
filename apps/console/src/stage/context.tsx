// What the stage offers the screens inside it: its layout, the phone (raise or lower a persona's frame),
// the director (one focal moment at a time), the run pill's next step (to pre-focus its control) and the
// autoplay state "Play it for me" drives (S1.6 `autoplay` and `paused`).

import { createContext, type RefObject, useContext, useEffect, useRef } from "react";
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
  /** A drawer beside the screen opened or closed (round 7): below 1440 px the console rail folds while one is open. */
  noteDrawer?(open: boolean): void;
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
  const first = useRef(true);
  const focused = useRef<{ target: HTMLElement; stepId: typeof stepId } | null>(null);
  useEffect(() => {
    if (!isStep || !when) return;
    const target = controlOf(ref.current);
    if (!target) return;
    const mounting = first.current;
    first.current = false;
    if (focused.current?.target !== target || focused.current?.stepId !== stepId) {
      if (mounting) prefocusQuietly(target);
      else focusAndReveal(target);
      focused.current = { target, stepId };
    }
    // While it is the step, it is the screen's main control: a focus return with nothing better lands on it. Read
    // when focus returns, so a control drawn again meanwhile (the press remounted at rest) is the one it finds.
    return registerScreenControl(() => controlOf(ref.current));
  }, [isStep, stepId, when, ref]);
}

/**
 * A screen's first pre-focus (UI gate round 3: one focus ring, on keyboard focus only). A browser treats focus moved
 * by script on a fresh page as keyboard focus and rings it, so the first press wore a ring nobody asked for. The
 * control takes focus without the ring (`focusVisible: false` where the browser has it, and `data-prefocused`, which
 * styles.css reads, where it does not); the first key the viewer presses gives the ring back, so a keyboard user
 * still sees where Enter will land.
 */
export function prefocusQuietly(target: HTMLElement): void {
  target.dataset.prefocused = "";
  target.focus({ preventScroll: true, focusVisible: false });
  const done = () => {
    delete target.dataset.prefocused;
    window.removeEventListener("keydown", done, true);
    target.removeEventListener("blur", done);
  };
  window.addEventListener("keydown", done, true);
  target.addEventListener("blur", done);
}

/** The control a step pre-focuses: `el` itself, or the slab face or first control inside it. */
function controlOf(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  if (el.matches("button, a, input, [tabindex]")) return el;
  return el.querySelector<HTMLElement>(".fs-slab__face, button, a, input, [tabindex]:not([tabindex='-1'])");
}
