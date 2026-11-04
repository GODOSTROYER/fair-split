// The Judge stage's breakpoints (S1.6's table, UI gate round 2): one phone docked at 1440 px and wider (a
// narrower column, with the rail folded to its glyphs, below 1680 px, so a 1470 laptop keeps the member's
// statement beside the console), a 64 px tab that rises below that, and a phone-visit layout under 1024 px. Drawers push the content aside below 1600 px (full
// width below 1280) and overlay at 560 px from 1600. Split review drops to five columns in containers under
// 1,180 px. Playwright snapshots run at 390, 1280, 1470, 1536, 1920 and 2560 px.

import { useSyncExternalStore } from "react";

export type PhoneLayout = "phone-visit" | "tab" | "dock";
export type DrawerMode = "push-full" | "push" | "overlay";

export const BREAKPOINTS = { visit: 1024, rail: 1280, dock: 1440, overlay: 1600, wide: 1680 } as const;
/** Container width under which the split grid shows five columns (S1.6). */
export const NARROW_GRID_PX = 1180;

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

/**
 * The console rail collapses to glyphs below 1280 px so the work keeps its width, and again beside the narrow
 * docked phone (1440-1679 px), where the screen keeps the width it has at 1280 px.
 */
export function railCollapsedAt(width: number): boolean {
  return width < BREAKPOINTS.rail || (width >= BREAKPOINTS.dock && width < BREAKPOINTS.wide);
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

/** The phone screen's size (S1.6: 360 px wide on the stage). Height fills what the stage leaves, clamped. */
export interface PhoneSize {
  readonly width: number;
  readonly height: number;
}

/** Vertical space the stage's own chrome takes around the phone screen, per layout (px). */
const PHONE_CHROME_PX = { dock: 340, tab: 370, visit: 184 } as const;

export function phoneSizeFor(layout: StageLayout, viewportHeight: number): PhoneSize {
  const clamp = (n: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, n)));
  // The phone visit: the member's statement, the page's full width (less the stage's 8 px gutters and the frame's
  // 10 px sides), as tall as the window leaves under the bar and the laptop line.
  if (layout.phone === "phone-visit")
    return {
      width: clamp(layout.width - 36, 260, 988),
      height: clamp(viewportHeight - PHONE_CHROME_PX.visit, 480, 1200),
    };
  if (layout.phone === "tab")
    return { width: 360, height: clamp(viewportHeight - PHONE_CHROME_PX.tab, 400, 680) };
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
