// S1.6's breakpoints and the stage director: one focal moment at a time, a moment that would wait more than
// 1.6 s plays reduced instead, item landings at least 250 ms apart and MM-2 rows at least 180 ms apart.

import { describe, expect, it } from "vitest";
import { MAX_FOCAL_WAIT_MS, StageDirector } from "./director.js";
import { phoneSizeFor, stageLayoutFor } from "./layout.js";

describe("stage layout (S1.6)", () => {
  it.each([
    [390, "phone-visit", "push-full", true],
    [1023, "phone-visit", "push-full", true],
    [1024, "tab", "push-full", true],
    [1280, "tab", "push", false],
    [1470, "tab", "push", false],
    [1600, "tab", "overlay", false],
    [1679, "tab", "overlay", false],
    [1680, "dock", "overlay", false],
    [2560, "dock", "overlay", false],
  ] as const)("%i px: phone %s, drawers %s, rail folded %s", (width, phone, drawer, railCollapsed) => {
    expect(stageLayoutFor(width)).toEqual({ width, phone, drawer, railCollapsed });
  });

  it("keeps the phone 360 px wide on the stage and fits its height to the window", () => {
    expect(phoneSizeFor(stageLayoutFor(1920), 1080)).toEqual({ width: 360, height: 780 });
    expect(phoneSizeFor(stageLayoutFor(1470), 956).width).toBe(360);
    expect(phoneSizeFor(stageLayoutFor(1280), 600).height).toBe(400);
    expect(phoneSizeFor(stageLayoutFor(390), 844)).toEqual({ width: 338, height: 700 });
  });
});

describe("stage director", () => {
  it("plays one focal moment at a time; a long wait plays reduced instead", () => {
    let t = 0;
    const director = new StageDirector(() => t);
    const first = director.claim("MM-3", 1000);
    expect(first).toMatchObject({ delayMs: 0, mode: "full" });
    expect(director.current()).toBe("MM-3");
    const second = director.claim("MM-1", 900);
    expect(second).toMatchObject({ delayMs: 1000, mode: "full" });
    const third = director.claim("MM-6", 500);
    expect(third.mode).toBe("reduced"); // would wait 1,900 ms > 1,600 ms
    expect(1900).toBeGreaterThan(MAX_FOCAL_WAIT_MS);
    t = 2000;
    expect(director.current()).toBeNull();
  });

  it("a released claim frees the stage at once", () => {
    let t = 0;
    const director = new StageDirector(() => t);
    const claim = director.claim("MM-4", 300);
    t = 100;
    claim.release();
    expect(director.claim("MM-5", 100).delayMs).toBe(0);
  });

  it("spaces PayPal landings 250 ms apart and printed rows 180 ms apart", () => {
    let t = 0;
    const director = new StageDirector(() => t);
    expect([director.space("item"), director.space("item"), director.space("item")]).toEqual([0, 250, 500]);
    expect([director.space("row"), director.space("row")]).toEqual([0, 180]);
    t = 1000;
    expect(director.space("item")).toBe(0);
  });
});
