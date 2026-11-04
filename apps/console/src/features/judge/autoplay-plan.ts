// "Play it for me" (S1.6, plan "Judge Mode"): every 4 s or so it performs the step the run pill names, with a
// visible cursor, and stops before both keys ("Your turn: hold to approve", "Your turn: co-sign as Ernesto").
// This file is the pure planner: given the pill's step and where the stage is, what the cursor does next. The
// driver (Autoplay.tsx) moves the cursor and presses exactly what a person would press; the server's events
// then move the run, so nothing here changes state on its own.

import type { NextStep } from "../../chrome/next-step.js";

/** S1.6: "Every 4 s or so it performs the step the pill names." */
export const AUTOPLAY_STEP_MS = 4000;

export const AUTOPLAY_COPY = {
  play: "Play it for me",
  resume: "Play it for me",
  stop: "Stop autoplay",
  stopSr: "Stop autoplay and drive yourself",
  cursor: "Autoplay",
  approveTurn: "Your turn: hold to approve",
  cosignTurn: "Your turn: co-sign as Ernesto",
  stuck: "Your turn: this step needs you",
  done: "Opening Proof",
} as const;

/** The run pill's link: autoplay goes where the pill points by clicking it, as a person would. */
export const PILL_LINK = '[data-testid="W-JG-01.runPill.next"]';

export type AutoplayPlan =
  /** Not on the step's screen: click the pill's link. */
  | { readonly kind: "go"; readonly to: string; readonly selector: string }
  /** Press the first control that matches, in order (the step's screen is showing). */
  | { readonly kind: "press"; readonly selectors: readonly string[] }
  /** The machine or PayPal moves next: watch. */
  | { readonly kind: "wait" }
  /** A key, or a step only a person can take: point at it, say so, and stop. */
  | { readonly kind: "turn"; readonly message: string; readonly selectors: readonly string[] }
  /** The run is done: open Proof and stop. */
  | { readonly kind: "finish"; readonly selector: string };

export interface StageLocation {
  readonly pathname: string;
  /** The query string, with or without "?". */
  readonly search: string;
}

/** True when the stage shows the pill's destination (path and the query the step needs). */
export function isAt(location: StageLocation, to: string): boolean {
  const [path = "", query = ""] = to.split("?");
  if (location.pathname !== path) return false;
  // The step's own query (?hold=H2) must match; extra keys on the page are fine.
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(
    location.search.startsWith("?") ? location.search.slice(1) : location.search,
  );
  for (const [k, v] of want.entries()) if (have.get(k) !== v) return false;
  return true;
}

const enabledSlab = (screen: string) =>
  `[data-testid="${screen}"] .fs-slab__face:not([aria-disabled="true"])`;

/** What autoplay does for the pill's step. Pure: the driver resolves the selectors against the page. */
export function planStep(next: NextStep, location: StageLocation): AutoplayPlan {
  const here = isAt(location, next.to);
  const go: AutoplayPlan = { kind: "go", to: next.to, selector: PILL_LINK };
  switch (next.id) {
    case "mark-paid":
      return here ? { kind: "press", selectors: ['[data-testid="W-JG-01.markPaid.face"]'] } : go;
    case "recording":
    case "reading":
    case "confirming":
      return here ? { kind: "wait" } : go;
    case "by-hand":
      return here
        ? {
            kind: "press",
            selectors: [
              '[data-testid="W-TR-04.useLogbook"]:not([data-used])',
              '[data-testid="W-TR-04.commit.face"]:not([aria-disabled="true"])',
            ],
          }
        : go;
    case "holds":
      return here ? { kind: "press", selectors: [enabledSlab("W-TR-06")] } : go;
    case "rhea":
      return here ? { kind: "press", selectors: [enabledSlab("W-TR-08")] } : go;
    case "approve":
      return here
        ? {
            kind: "turn",
            message: AUTOPLAY_COPY.approveTurn,
            selectors: ['[data-testid="W-TR-07"] .fs-slab__face'],
          }
        : go;
    case "cosign":
      return {
        kind: "turn",
        message: AUTOPLAY_COPY.cosignTurn,
        selectors: ['[data-testid="W-JG-01.frame.chair"]', '[data-testid="W-JG-01.phoneTab"]', PILL_LINK],
      };
    case "done":
      return { kind: "finish", selector: PILL_LINK };
    case "denied":
    case "halted":
    case "cancelled":
      return { kind: "turn", message: next.text, selectors: [PILL_LINK] };
  }
}

/** The first selector that names an element on the page. */
export function resolveTarget(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/** Where the cursor points on an element: a little inside its left edge, at its middle (viewport px). */
export function aimAt(rect: Pick<DOMRect, "left" | "top" | "width" | "height">): { x: number; y: number } {
  return {
    x: Math.round(rect.left + Math.min(rect.width / 2, 28)),
    y: Math.round(rect.top + rect.height / 2),
  };
}
