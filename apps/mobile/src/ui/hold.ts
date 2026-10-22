/**
 * Hold-to-commit (S2.7): arm on hold, act on release inside. The signature happens on release, never on a timer.
 * The Slab primitive (ui/slab.tsx) runs this machine; it is pure, so the rule "no approval before a release inside"
 * (I6) is tested without a device.
 *
 * - A pointer, touch, pen or Space hold drives the slab: reaching the hold time arms it ("Release to sign"),
 *   releasing inside acts, and leaving the slab, a cancel, blur or a hidden page disarms it.
 * - Enter, a virtual click (screen readers, `element.click()`), the visible "Can't hold?" link, or TalkBack on the
 *   phone open the ConfirmDialog instead. The route is chosen per event, never by detecting a screen reader on web.
 */

export type HoldState =
  | "rest"
  | "holding"
  | "armed"
  | "confirm"
  | "committed"
  | "released-early"
  | "disarmed";

export type HoldEvent =
  | { type: "press" }
  | { type: "complete" }
  | { type: "release"; inside: boolean }
  | { type: "cancel" }
  | { type: "activate" }
  | { type: "dialog-confirm" }
  | { type: "dialog-cancel" }
  | { type: "reset" };

/** States from which a new hold or the dialog may start. */
const IDLE: ReadonlySet<HoldState> = new Set(["rest", "released-early", "disarmed"]);

export function holdReducer(state: HoldState, event: HoldEvent): HoldState {
  if (event.type === "reset") return "rest";
  if (state === "committed") return state; // one commit per slab: a second release or confirm does nothing
  switch (event.type) {
    case "press":
      return IDLE.has(state) ? "holding" : state;
    case "complete":
      return state === "holding" ? "armed" : state;
    case "release":
      if (state === "holding") return "released-early";
      if (state === "armed") return event.inside ? "committed" : "disarmed";
      return state;
    case "cancel":
      if (state === "holding") return "released-early";
      if (state === "armed") return "disarmed";
      return state;
    case "activate":
      return IDLE.has(state) ? "confirm" : state;
    case "dialog-confirm":
      return state === "confirm" ? "committed" : state;
    case "dialog-cancel":
      return state === "confirm" ? "rest" : state;
  }
}

/** True exactly when a transition commits, so the caller signs once. */
export function commits(before: HoldState, after: HoldState): boolean {
  return before !== "committed" && after === "committed";
}

export type PressOrigin = "mouse" | "touch" | "pen" | "keyboard" | "virtual";

/**
 * Who gets the dialog, per event (S2.7): Enter and virtual clicks open it; pointers and Space hold. A screen reader
 * on the phone is the one detected case, and it lives on native only.
 */
export function routeFor(origin: PressOrigin, key?: string): "hold" | "dialog" {
  if (origin === "virtual") return "dialog";
  if (origin === "keyboard") return key === " " || key === "Spacebar" ? "hold" : "dialog";
  return "hold";
}

/** The phone's MM-5 phases for the second key (S2.9). */
export function mm5Phase(
  state: HoldState,
): "ready" | "hold-2" | "armed-2" | "confirm-2" | "released-early" | "disarmed" {
  switch (state) {
    case "holding":
      return "hold-2";
    case "armed":
    case "committed":
      return "armed-2";
    case "confirm":
      return "confirm-2";
    case "released-early":
      return "released-early";
    case "disarmed":
      return "disarmed";
    default:
      return "ready";
  }
}

/** Hold progress in quarters (the stepped bar and the tick at 300, 600 and 900 ms of a 1,200 ms hold). */
export function quarterAt(elapsedMs: number, holdMs: number): 0 | 1 | 2 | 3 | 4 {
  if (holdMs <= 0) return 4;
  return Math.max(0, Math.min(4, Math.floor((elapsedMs / holdMs) * 4))) as 0 | 1 | 2 | 3 | 4;
}

/** The Slab's `data-state` while a hold runs (S2.7): the dialog and the early releases rest. */
export function slabStateFor(state: HoldState): "rest" | "holding" | "armed" | "committed" {
  if (state === "holding" || state === "armed" || state === "committed") return state;
  return "rest";
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a web release happened: a pointer or mouse event's client point, or a touch's changed touch. */
export function releasePoint(e: unknown): Point | null {
  if (!e || typeof e !== "object") return null;
  const ev = e as {
    clientX?: unknown;
    clientY?: unknown;
    changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
  };
  const touch = ev.changedTouches && ev.changedTouches.length > 0 ? ev.changedTouches[0] : undefined;
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (typeof ev.clientX === "number" && typeof ev.clientY === "number")
    return { x: ev.clientX, y: ev.clientY };
  return null;
}

/** Inside the slab's box, with the edge itself counting as inside (WCAG 2.5.2: up-event inside the target). */
export function isInside(p: Point | null, r: Rect | null): boolean {
  if (!p || !r) return false;
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/** Releases that are really cancellations: the browser took the gesture, or text selection ended it. */
export function isCancelEvent(e: unknown): boolean {
  const type = e && typeof e === "object" ? (e as { type?: unknown }).type : undefined;
  return type === "pointercancel" || type === "touchcancel" || type === "selectionchange" || type === "blur";
}
