// The Judge stage's breakpoints (S1.6's table): one phone docked at 1680 px and wider, a 64 px tab that rises
// below that, and a phone-visit layout under 1024 px. Drawers push the content aside below 1600 px (full
// width below 1280) and overlay at 560 px from 1600. Split review drops to five columns in containers under
// 1,180 px. Playwright snapshots run at 390, 1280, 1470, 1536, 1920 and 2560 px.

import { useSyncExternalStore } from "react";

export type PhoneLayout = "phone-visit" | "tab" | "dock";
export type DrawerMode = "push-full" | "push" | "overlay";

export const BREAKPOINTS = { visit: 1024, rail: 1280, overlay: 1600, dock: 1680 } as const;
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

/** The console rail collapses to glyphs below 1280 px so the work keeps its width. */
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

/** The phone screen's size (S1.6: 360 px wide on the stage). Height fills what the stage leaves, clamped. */
export interface PhoneSize {
  readonly width: number;
  readonly height: number;
}

/** Vertical space the stage's own chrome takes around the phone screen, per layout (px). */
const PHONE_CHROME_PX = { dock: 300, tab: 370 } as const;

export function phoneSizeFor(layout: StageLayout, viewportHeight: number): PhoneSize {
  const clamp = (n: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, n)));
  if (layout.phone === "phone-visit") return { width: clamp(layout.width - 52, 280, 390), height: 700 };
  if (layout.phone === "tab")
    return { width: 360, height: clamp(viewportHeight - PHONE_CHROME_PX.tab, 400, 680) };
  return { width: 360, height: clamp(viewportHeight - PHONE_CHROME_PX.dock, 480, 780) };
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
