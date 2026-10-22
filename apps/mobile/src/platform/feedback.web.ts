/**
 * The web promises no haptics (design §4), and a phone frame never plays sound itself: it forwards each event to the
 * judge stage as IC-12 `fs.feedback`, and the stage plays it if the viewer turned sound on (S2.10). Outside a frame
 * (the web export opened on its own) the app is silent.
 */
import type { FeedbackEvent } from "../_shims/motion";
import { stage } from "../services/frame-bridge";

export type { FeedbackEvent } from "../_shims/motion";

let narrating = false;

export const feedback = {
  play(event: FeedbackEvent, opts?: { index?: number }): void {
    if (narrating) return;
    stage.feedback(event, opts?.index);
  },
  preload(): void {},
  narration(on: boolean): void {
    narrating = on;
  },
};
