// Vitest setup for the console, after WS-DS's test/setup.ts (cleanup, matchMedia, ResizeObserver): the browser
// APIs jsdom lacks that the stage and Base UI touch, and a clean slate between tests (storage, the moment
// trace, the viewport). No network: anything that reaches fetch without a handler fails the test.

import { afterEach, beforeEach } from "vitest";
import { clearProofChecks } from "../lib/proof-checks.js";
import { resetViewport } from "./viewport.js";

const w = window as Window & {
  requestIdleCallback?: (cb: IdleRequestCallback) => number;
  cancelIdleCallback?: (id: number) => void;
};

if (!w.requestIdleCallback) {
  // Frames load "once the console is idle": in tests, on the next task.
  w.requestIdleCallback = (cb: IdleRequestCallback) =>
    window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);
  w.cancelIdleCallback = (id: number) => window.clearTimeout(id);
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

// jsdom defines scrollTo as a "Not implemented" placeholder (it prints on every call), so this one is replaced
// unconditionally: TanStack Router's scroll restoration calls it on every navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

if (!("getAnimations" in Element.prototype)) {
  (Element.prototype as unknown as { getAnimations: () => Animation[] }).getAnimations = () => [];
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => undefined },
  });
}

beforeEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // storage may be blocked; nothing to clear
  }
  window.__fsMoments = [];
  document.documentElement.dataset.theme = "adlaw";
  document.documentElement.removeAttribute("data-datamode");
  // The Proof counter's six checks are per tab: each test starts unchecked.
  clearProofChecks();
});

afterEach(() => {
  resetViewport();
});
