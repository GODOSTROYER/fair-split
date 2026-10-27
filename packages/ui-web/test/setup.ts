// jsdom lacks a few browser APIs the primitives touch; tests also skip Motion's animations (S2 §2.8: test
// builds set MotionGlobalConfig.skipAnimations). Animation frames come from ./frames.ts, loaded first.

import { act, cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach } from "vitest";
import { flushFrames } from "./frames.js";

MotionGlobalConfig.skipAnimations = true;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.hasPointerCapture = () => false;
}

afterEach(() => {
  act(() => flushFrames());
  cleanup();
  flushFrames();
});
