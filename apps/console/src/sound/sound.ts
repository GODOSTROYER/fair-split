// Sound and haptics plumbing for the stage (design §4, S2.10). ui-web's `feedback` is the page's only mixer:
// sounds are synthesised from @fairsplit/motion's recipes, off by default, behind a visible toggle,
// remembered per viewer, never autoplayed. Browsers only start audio inside a user gesture, so a remembered
// "on" resumes on the viewer's first press. Phone frames never play sound themselves: they post
// fs.feedback and the stage plays it (IC-12). The web promises no haptics at all.

import type { FeedbackEvent } from "@fairsplit/motion";
import { feedback } from "@fairsplit/ui-web";
import { useCallback, useSyncExternalStore } from "react";
import { readStored } from "../lib/storage.js";

/** ui-web's storage key for the viewer's choice ("on" or "off"). */
export const SOUND_KEY = "fs.sound";

let installed = false;

/** Restores the remembered choice and resumes audio on the first gesture. Call once at startup. */
export function installSound(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  if (installed) return () => undefined;
  installed = true;
  feedback.restore();
  const resume = () => {
    if (feedback.isSoundOn()) feedback.setSound(true); // creates or resumes the AudioContext inside the gesture
    target.removeEventListener("pointerdown", resume);
    target.removeEventListener("keydown", resume);
  };
  target.addEventListener("pointerdown", resume);
  target.addEventListener("keydown", resume);
  return () => {
    installed = false;
    target.removeEventListener("pointerdown", resume);
    target.removeEventListener("keydown", resume);
  };
}

/** True once the viewer has said yes or no to sound (the one-time chip never shows again). */
export function soundDecided(): boolean {
  const stored = readStored(SOUND_KEY);
  return stored === "on" || stored === "off";
}

function subscribe(listener: () => void): () => void {
  return feedback.onChange(listener);
}

function read(): boolean {
  return feedback.isSoundOn();
}

export interface SoundApi {
  readonly on: boolean;
  /** Call from a click or key handler: that gesture is what lets the browser start audio. */
  set(on: boolean): void;
  toggle(): void;
}

export function useSound(): SoundApi {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => feedback.setSound(next), []);
  const toggle = useCallback(() => feedback.setSound(!feedback.isSoundOn()), []);
  return { on, set, toggle };
}

/** Plays a frame's feedback on the stage (fs.feedback). Silent unless the viewer turned sound on. */
export function playFromFrame(event: FeedbackEvent, index?: number): void {
  feedback.play(event, index === undefined ? {} : { index });
}

/** No product sound under narration or Paminawa (S2.10). */
export function duck(channel: "narration" | "paminawa", on: boolean): void {
  feedback.duck(channel, on);
}
