// The Judge stage's breakpoints (S1.6's table, UI gate round 3): from 1440 px the phone has a column of its own (a
// narrower one below 1680), and below that it rises over or beside the screen; under 1024 px the stage is a phone
// visit. At every desktop width the phone folds to a 56 px rail on the steps where it does not change (the rate
// card, the reading room, slip 0462 by hand, split review and the holds), and below 1680 px on every step: it
// opens on its own on the phone's beats (key 2, "Bayad na", the traced peso) and when the viewer asks. The console
// rail keeps its labels from 1280 px (the 1,470 laptop included) and folds to glyphs below. Drawers push the
// content aside below 1600 px (full width below 1280) and overlay at 560 px from 1600. Split review drops to five
// columns in containers under 1,180 px. Playwright snapshots run at 390, 1280, 1470, 1536, 1920 and 2560 px.

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { RailItem } from "../chrome/rail-items.js";

export type PhoneLayout = "phone-visit" | "tab" | "dock";
export type DrawerMode = "push-full" | "push" | "overlay";

export const BREAKPOINTS = { visit: 1024, rail: 1280, dock: 1440, overlay: 1600, wide: 1680 } as const;
/** Container width under which the split grid shows five columns (S1.6). */
export const NARROW_GRID_PX = 1180;
/** The folded phone's rail (round 3). */
export const PHONE_RAIL_PX = 56;

export function phoneLayoutFor(width: number): PhoneLayout {
  if (width < BREAKPOINTS.visit) return "phone-visit";
  if (width < BREAKPOINTS.dock) return "tab";
  return "dock";
}

export function drawerModeFor(width: number): DrawerMode {
  if (width < BREAKPOINTS.rail) return "push-full";
  if (width < BREAKPOINTS.overlay) return "push";
  return "overlay";
}

/** The console rail folds to glyphs below 1280 px only: from there up its places keep their labels (round 3). */
export function railCollapsedAt(width: number): boolean {
  return width < BREAKPOINTS.rail;
}

export interface StageLayout {
  readonly width: number;
  readonly phone: PhoneLayout;
  readonly drawer: DrawerMode;
  readonly railCollapsed: boolean;
}

export function stageLayoutFor(width: number): StageLayout {
  return {
    width,
    phone: phoneLayoutFor(width),
    drawer: drawerModeFor(width),
    railCollapsed: railCollapsedAt(width),
  };
}

/**
 * Places on which the phone shows nothing new: the rate card, the reading room (slip 0462 by hand too) and split
 * review (its holds and member lines too). It folds to its rail there (round 3).
 */
export const PHONE_STILL_PLACES: ReadonlySet<RailItem["id"]> = new Set(["rate-card", "reading", "split"]);

/** Steps on which the phone shows nothing new either, whatever the screen (the reading replays on the console). */
const PHONE_STILL_STEPS: ReadonlySet<string> = new Set(["recording", "reading"]);

/**
 * The phone's resting fold on a place and step, before any beat or the viewer's own choice: folded on the still
 * places and steps at every width, and below 1680 px everywhere (the console keeps its width there); open beside the
 * first view, Approve and the run from 1680 px.
 */
export function phoneRestsFolded(layout: StageLayout, place: RailItem["id"] | null, step: string): boolean {
  if (layout.phone === "phone-visit") return false;
  if (layout.phone === "tab" || layout.width < BREAKPOINTS.wide) return true;
  if (place !== null && PHONE_STILL_PLACES.has(place)) return true;
  return PHONE_STILL_STEPS.has(step);
}

/** The phone screen's size (S1.6: 360 px wide on the stage). Height fills what the stage leaves, clamped. */
export interface PhoneSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Vertical space the stage's own chrome takes around the phone screen, per layout (px): no ribbon since round 3. The
 * phone visit's is its bar (88 px with the honesty line under the lockup) and three 8 px gutters, until the bar is
 * measured (useVisitHeight).
 */
const PHONE_CHROME_PX = { dock: 250, tab: 280, visit: 112 } as const;

/** The phone visit's side gutters (the stage's 8 px each side): the statement is edge to edge with the bar. */
const VISIT_GUTTERS_PX = 16;

/**
 * @param visitHeight On the phone visit, the height the window leaves under the bar to its foot, measured
 *   (useVisitHeight); until then the bar's usual height stands in.
 */
export function phoneSizeFor(
  layout: StageLayout,
  viewportHeight: number,
  visitHeight?: number | null,
): PhoneSize {
  const clamp = (n: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, n)));
  // The phone visit (round 4): the member's statement edge to edge with the bar, and down to the window's foot, so
  // its tab bar sits at the bottom of the screen (above the safe area) and no grey band is left under it.
  if (layout.phone === "phone-visit")
    return {
      width: clamp(layout.width - VISIT_GUTTERS_PX, 260, 1008),
      height: clamp(visitHeight ?? viewportHeight - PHONE_CHROME_PX.visit, 480, 1200),
    };
  if (layout.phone === "tab")
    return { width: 360, height: clamp(viewportHeight - PHONE_CHROME_PX.tab, 400, 720) };
  // The narrow dock (1440-1679 px) keeps a 340 px screen; from 1680 px it is S1.6's 360.
  const width = layout.width < BREAKPOINTS.wide ? 340 : 360;
  return { width, height: clamp(viewportHeight - PHONE_CHROME_PX.dock, 480, 780) };
}

function readWidth(): number {
  return typeof window === "undefined" ? 1470 : window.innerWidth;
}

function readHeight(): number {
  return typeof window === "undefined" ? 956 : window.innerHeight;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/** The viewport width, live. */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, readWidth, () => 1470);
}

/** The viewport height, live. */
export function useViewportHeight(): number {
  return useSyncExternalStore(subscribe, readHeight, () => 956);
}

export function useStageLayout(): StageLayout {
  return stageLayoutFor(useViewportWidth());
}

/**
 * The phone visit's statement height (round 4): from the phone's top (under the bar, whose height follows its
 * honesty line and any mock chip) to the window's foot, less the stage's bottom padding (its gutter, or the safe area
 * when that is taller). Measured on mount, on resize and whenever the bar changes size; null off the visit.
 */
export function useVisitHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setHeight(null);
      return;
    }
    const measure = () => {
      const stage = document.querySelector<HTMLElement>('[data-testid="W-JG-01.stage"]');
      const phone = document.querySelector<HTMLElement>('[data-testid="W-JG-01.phone"]');
      if (!stage || !phone) return;
      const top = phone.getBoundingClientRect().top + window.scrollY;
      const foot = Number.parseFloat(getComputedStyle(stage).paddingBottom) || 0;
      const next = Math.round(window.innerHeight - top - foot);
      if (next > 0) setHeight(next);
    };
    measure();
    window.addEventListener("resize", measure);
    const bar = document.querySelector<HTMLElement>('[data-testid="W-JG-01.stage"] .fsc-bar');
    const observer = typeof ResizeObserver === "undefined" || !bar ? null : new ResizeObserver(measure);
    if (bar) observer?.observe(bar);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [enabled]);
  return height;
}
