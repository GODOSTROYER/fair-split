// The stage lays itself out from the window's size (S1.6's breakpoints). Tests set it with setViewport before
// rendering, or during a test to watch the layout move; afterEach puts it back.

import { act } from "@testing-library/react";

const DEFAULT = { width: 1470, height: 956 } as const;

function define(name: "innerWidth" | "innerHeight", value: number): void {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

/** Sizes the window and tells listeners, like a real resize. Wrap in act() when something is rendered. */
export function setViewport(width: number, height: number = DEFAULT.height): void {
  define("innerWidth", width);
  define("innerHeight", height);
  window.dispatchEvent(new Event("resize"));
}

/** setViewport inside act(), for a rendered stage. */
export function resizeTo(width: number, height?: number): void {
  act(() => setViewport(width, height));
}

/** The MacBook Air default S2.12 captures at: 1470 × 956. */
export function resetViewport(): void {
  define("innerWidth", DEFAULT.width);
  define("innerHeight", DEFAULT.height);
}

/** S1.6's Playwright widths, for tests that walk every layout. */
export const STAGE_WIDTHS = [390, 1280, 1470, 1536, 1920, 2560] as const;
