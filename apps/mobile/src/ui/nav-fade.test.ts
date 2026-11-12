import { describe, expect, it } from "vitest";
import { NAV_FADE_PX, navFadeBands } from "./nav-fade";

describe("the fade above the navigation bar (UI gate round 3)", () => {
  it("covers the content's last 12 px in bands that grow towards the bar's plate", () => {
    const bands = navFadeBands();
    expect(NAV_FADE_PX).toBe(12);
    expect(bands.reduce((sum, b) => sum + b.height, 0)).toBe(12);
    expect(bands[0]?.top).toBe(0);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]?.top).toBe((bands[i - 1]?.top ?? 0) + (bands[i - 1]?.height ?? 0));
      expect(bands[i]?.opacity).toBeGreaterThan(bands[i - 1]?.opacity ?? 1);
    }
    // Never a hard edge: the band against the bar is not yet solid, the bar's plate is.
    expect(bands.at(-1)?.opacity).toBeLessThan(1);
  });
});
