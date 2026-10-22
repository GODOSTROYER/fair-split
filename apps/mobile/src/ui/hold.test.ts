import { describe, expect, it } from "vitest";
import {
  commits,
  type HoldEvent,
  type HoldState,
  holdReducer,
  isCancelEvent,
  isInside,
  mm5Phase,
  quarterAt,
  releasePoint,
  routeFor,
  slabStateFor,
} from "./hold";

function run(events: HoldEvent[], from: HoldState = "rest") {
  let s = from;
  let commitsSeen = 0;
  for (const e of events) {
    const next = holdReducer(s, e);
    if (commits(s, next)) commitsSeen++;
    s = next;
  }
  return { state: s, commits: commitsSeen };
}

describe("hold-to-commit: arm on hold, act on release inside (S2.7)", () => {
  it("signs on the release inside, not when the hold time is reached", () => {
    expect(run([{ type: "press" }, { type: "complete" }])).toEqual({ state: "armed", commits: 0 });
    expect(run([{ type: "press" }, { type: "complete" }, { type: "release", inside: true }])).toEqual({
      state: "committed",
      commits: 1,
    });
  });

  it("inv.i6.release-outside: a hold released outside the slab arms but signs nothing", () => {
    expect(run([{ type: "press" }, { type: "complete" }, { type: "release", inside: false }])).toEqual({
      state: "disarmed",
      commits: 0,
    });
  });

  it("inv.i6.cancel-disarms: pointercancel, blur or a hidden page disarms an armed slab", () => {
    expect(run([{ type: "press" }, { type: "complete" }, { type: "cancel" }])).toEqual({
      state: "disarmed",
      commits: 0,
    });
  });

  it("a release before the hold time is an early release, and the slab can be held again", () => {
    const early = run([{ type: "press" }, { type: "release", inside: true }]);
    expect(early).toEqual({ state: "released-early", commits: 0 });
    expect(
      run([{ type: "press" }, { type: "complete" }, { type: "release", inside: true }], early.state),
    ).toEqual({
      state: "committed",
      commits: 1,
    });
  });

  it("commits exactly once: a second release, confirm or hold after the commit changes nothing", () => {
    const r = run([
      { type: "press" },
      { type: "complete" },
      { type: "release", inside: true },
      { type: "press" },
      { type: "complete" },
      { type: "release", inside: true },
      { type: "activate" },
      { type: "dialog-confirm" },
    ]);
    expect(r).toEqual({ state: "committed", commits: 1 });
  });

  it("the dialog route signs only on its own confirm, and cancel returns to rest", () => {
    expect(run([{ type: "activate" }])).toEqual({ state: "confirm", commits: 0 });
    expect(run([{ type: "activate" }, { type: "dialog-cancel" }])).toEqual({ state: "rest", commits: 0 });
    expect(run([{ type: "activate" }, { type: "dialog-confirm" }])).toEqual({
      state: "committed",
      commits: 1,
    });
    // The dialog cannot open in the middle of a hold.
    expect(run([{ type: "press" }, { type: "activate" }])).toEqual({ state: "holding", commits: 0 });
  });

  it("reset lets a failed signature be tried again", () => {
    expect(holdReducer("committed", { type: "reset" })).toBe("rest");
  });
});

describe("who gets the dialog is chosen per event", () => {
  it("routes Enter and virtual clicks to the dialog, pointers and Space to the hold", () => {
    expect(routeFor("keyboard", "Enter")).toBe("dialog");
    expect(routeFor("virtual")).toBe("dialog");
    expect(routeFor("keyboard", " ")).toBe("hold");
    expect(routeFor("mouse")).toBe("hold");
    expect(routeFor("touch")).toBe("hold");
    expect(routeFor("pen")).toBe("hold");
  });
});

describe("MM-5 phases on the phone (S2.9)", () => {
  it("maps the slab to the second key's phases", () => {
    expect(mm5Phase("rest")).toBe("ready");
    expect(mm5Phase("holding")).toBe("hold-2");
    expect(mm5Phase("armed")).toBe("armed-2");
    expect(mm5Phase("committed")).toBe("armed-2");
    expect(mm5Phase("confirm")).toBe("confirm-2");
    expect(mm5Phase("released-early")).toBe("released-early");
    expect(mm5Phase("disarmed")).toBe("disarmed");
  });

  it("ticks at each quarter of a 1,200 ms hold", () => {
    expect([0, 299, 300, 600, 900, 1199, 1200, 5000].map((ms) => quarterAt(ms, 1200))).toEqual([
      0, 0, 1, 2, 3, 3, 4, 4,
    ]);
  });
});

describe("web release geometry", () => {
  const rect = { left: 10, top: 20, right: 210, bottom: 84 };

  it("reads the release point from pointer, mouse and touch events", () => {
    expect(releasePoint({ type: "pointerup", clientX: 50, clientY: 40 })).toEqual({ x: 50, y: 40 });
    expect(releasePoint({ type: "touchend", changedTouches: [{ clientX: 12, clientY: 83 }] })).toEqual({
      x: 12,
      y: 83,
    });
    expect(releasePoint({ type: "keyup", key: " " })).toBeNull();
    expect(releasePoint(null)).toBeNull();
  });

  it("inv.i6.release-inside: only a release inside the slab acts, the edge included", () => {
    expect(isInside({ x: 10, y: 20 }, rect)).toBe(true);
    expect(isInside({ x: 210, y: 84 }, rect)).toBe(true);
    expect(isInside({ x: 211, y: 50 }, rect)).toBe(false);
    expect(isInside({ x: 50, y: 19 }, rect)).toBe(false);
    expect(isInside(null, rect)).toBe(false);
    expect(isInside({ x: 50, y: 50 }, null)).toBe(false);
  });

  it("treats a browser cancel as a cancel, never as a release", () => {
    expect(isCancelEvent({ type: "pointercancel" })).toBe(true);
    expect(isCancelEvent({ type: "touchcancel" })).toBe(true);
    expect(isCancelEvent({ type: "pointerup" })).toBe(false);
  });

  it("maps the hold machine onto the Slab's data-state", () => {
    expect(slabStateFor("holding")).toBe("holding");
    expect(slabStateFor("armed")).toBe("armed");
    expect(slabStateFor("committed")).toBe("committed");
    expect(slabStateFor("released-early")).toBe("rest");
    expect(slabStateFor("confirm")).toBe("rest");
  });
});
