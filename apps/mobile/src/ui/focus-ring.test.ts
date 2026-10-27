import { describe, expect, it } from "vitest";
import { focusRingVisible, focusVisibleOf, trackInputModality } from "./focus-ring";

/** A window-like event target: listeners by type, and a way to fire them. */
function fakeWindow() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(type: string, cb: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    fire(type: string, e: Record<string, unknown> = {}) {
      for (const cb of listeners.get(type) ?? []) cb({ type, ...e });
    },
    count: () => [...listeners.values()].reduce((n, l) => n + l.length, 0),
  };
}

describe("the slab's focus ring shows for keyboard focus only (S2.7)", () => {
  it("follows the browser's :focus-visible when it answers", () => {
    expect(focusRingVisible({ web: true, focusVisible: true, lastInput: "pointer" })).toBe(true);
    expect(focusRingVisible({ web: true, focusVisible: false, lastInput: "keyboard" })).toBe(false);
  });

  it("falls back to the last input when the browser cannot say: a click or tap never rings", () => {
    expect(focusRingVisible({ web: true, focusVisible: null, lastInput: "pointer" })).toBe(false);
    expect(focusRingVisible({ web: true, focusVisible: null, lastInput: "keyboard" })).toBe(true);
    // Focus before any input (a screen's first focus, a reader moving focus) is not a click: it rings.
    expect(focusRingVisible({ web: true, focusVisible: null, lastInput: null })).toBe(true);
  });

  it("draws no ring on the phone, where the platform draws its own", () => {
    expect(focusRingVisible({ web: false, focusVisible: true, lastInput: "keyboard" })).toBe(false);
  });

  it("asks the element itself, and answers null for anything that cannot match a selector", () => {
    const el = (visible: boolean) => ({ matches: (s: string) => s === ":focus-visible" && visible });
    expect(focusVisibleOf(el(true))).toBe(true);
    expect(focusVisibleOf(el(false))).toBe(false);
    expect(focusVisibleOf(null)).toBeNull();
    expect(focusVisibleOf({})).toBeNull();
    expect(
      focusVisibleOf({
        matches: () => {
          throw new SyntaxError("unknown pseudo-class");
        },
      }),
    ).toBeNull();
  });

  it("tracks the last input: keys are the keyboard, pointers and touches are not", () => {
    const win = fakeWindow();
    const last = trackInputModality(win);
    expect(last()).toBeNull();
    win.fire("keydown", { key: "Tab" });
    expect(last()).toBe("keyboard");
    win.fire("pointerdown");
    expect(last()).toBe("pointer");
    win.fire("keydown", { key: " " });
    expect(last()).toBe("keyboard");
    win.fire("touchstart");
    expect(last()).toBe("pointer");
    win.fire("mousedown");
    expect(last()).toBe("pointer");
  });

  it("does not count a modifier held for a click as keyboard use", () => {
    const win = fakeWindow();
    const last = trackInputModality(win);
    win.fire("pointerdown");
    for (const key of ["Shift", "Control", "Alt", "Meta"]) win.fire("keydown", { key });
    expect(last()).toBe("pointer");
  });
});
