/**
 * IC-12 FrameBridge, the frame side (approved plan; S3.8). The judge stage embeds this web export in same-origin
 * phone frames (Member, Chair, Clerk). The stage sends a 2-hour frame token (`fs.token`, never a URL), display
 * preferences (`fs.prefs`: tier, sound, reduced motion, English gloss) and resets (`fs.reset`). The frame reports
 * `fs.ready`, moment phases, feedback events (only the stage plays sound) and the screen it shows.
 *
 * Shell infrastructure: the state provider adopts the token and preferences, the feedback layer forwards sounds,
 * `useMoment` forwards phases and `<Screen>` forwards focus. Native has no stage, so everything here is a no-op there.
 */
import { Platform } from "react-native";
import type { FramePrefs, ScreenId, ToStage } from "../_shims/contracts";
import type { FeedbackEvent } from "../_shims/motion";
import {
  acceptFromStage,
  expiryIso,
  feedbackMessage,
  focusMessage,
  momentMessage,
  personaMemberNo,
  personaRole,
  readyMessage,
} from "./frame-protocol";
import type { PairedSession } from "./session";

export { DEFAULT_FRAME_PREFS } from "./frame-protocol";

function detectFrame(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    return window.parent !== window;
  } catch {
    return true; // a cross-origin parent throws on access; we are framed, and will hear nothing from it
  }
}

/** True inside a stage phone frame (web export only). */
export const inFrame: boolean = detectFrame();

export interface FrameHandlers {
  /** `fs.token`: the frame becomes this persona's session; first run is skipped (judge frames never pair). */
  onSession(session: PairedSession): void;
  onPrefs(prefs: FramePrefs): void;
  /** `fs.reset`: forget the session and show the frame as new. */
  onReset(): void;
}

function post(msg: ToStage): void {
  if (!inFrame) return;
  try {
    window.parent.postMessage(msg, window.location.origin); // never "*"
  } catch {
    // A parent on another origin is ignored on purpose.
  }
}

/**
 * Starts listening to the stage and announces the frame. `frameId` is the iframe's `name` (the stage names its frames
 * `member`, `chair`, `clerk`), so the stage can match `fs.ready` without reading the URL.
 */
export function startFrameBridge(h: FrameHandlers, build: string): () => void {
  if (!inFrame) return () => {};
  const self = { origin: window.location.origin, parent: window.parent as unknown };
  const onMessage = (e: MessageEvent) => {
    const msg = acceptFromStage({ origin: e.origin, source: e.source, data: e.data }, self);
    if (!msg) return;
    if (msg.t === "fs.token") {
      const role = personaRole(msg.persona);
      if (!role) return;
      h.onSession({
        kind: "frame",
        bearer: msg.token,
        expiresAt: expiryIso(msg.exp),
        workspaceId: msg.ws,
        persona: msg.persona,
        role,
        memberNo: personaMemberNo(msg.persona),
        displayName: "",
        lang: null,
        pairedAt: new Date().toISOString(),
      });
    } else if (msg.t === "fs.prefs") {
      h.onPrefs({ tier: msg.tier, sound: msg.sound, reducedMotion: msg.reducedMotion, gloss: msg.gloss });
    } else {
      h.onReset();
    }
  };
  window.addEventListener("message", onMessage);
  post(readyMessage(window.name || "frame", null, build));
  return () => window.removeEventListener("message", onMessage);
}

/** Frame → stage messages. Outside a frame every call is a no-op. */
export const stage = {
  moment(moment: string, phase: string): void {
    post(momentMessage(moment, phase));
  },
  feedback(event: FeedbackEvent, index?: number): void {
    post(feedbackMessage(event, index));
  },
  focus(screenId: ScreenId): void {
    post(focusMessage(screenId));
  },
};
