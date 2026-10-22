// jsdom lacks a few browser APIs the primitives touch; tests also skip Motion's animations (S2 §2.8: test
// builds set MotionGlobalConfig.skipAnimations).

import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach } from "vitest";

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

// jsdom runs requestAnimationFrame off its own timer, and stops running frames for good when that timer was
// faked as vi.useRealTimers() ran. Frames on setTimeout keep working under fake and real timers alike (Base
// UI moves a dialog's initial focus in a frame).
{
  let lastFrame = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = ++lastFrame;
    frames.set(
      id,
      setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 16),
    );
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    const timer = frames.get(id);
    if (timer !== undefined) clearTimeout(timer);
    frames.delete(id);
  };
}

afterEach(() => cleanup());
