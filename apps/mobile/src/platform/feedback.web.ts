/**
 * The web promises no haptics (design §4). Stage phone frames will forward sound events to the parent with
 * `postMessage({type:'fs-feedback', event})` once WS-DS ships the sound mixer; until then this is silent.
 */
import type { FeedbackEvent } from "./feedback";

export type { FeedbackEvent } from "./feedback";

export const feedback = {
  play(event: FeedbackEvent): void {
    try {
      if (typeof window !== "undefined" && window.parent !== window) {
        window.parent.postMessage({ type: "fs-feedback", event }, window.location.origin);
      }
    } catch {
      // Cross-origin parents are ignored on purpose.
    }
  },
};
