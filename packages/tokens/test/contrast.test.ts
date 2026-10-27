// CI gate (design §2.7, S2 §2.2): the build fails if any declared colour pair drops below its target.
// 4.5:1 console text, 7:1 statement copy, 4.5:1 text on faces and washes, 3:1 non-text, 1.8:1 hatching.

import { describe, expect, it } from "vitest";
import { contrast } from "../src/color.js";
import { contrastResults, RESOLVED } from "../src/resolve.js";
import { CONTRAST_RULES, THEMES } from "../src/tokens.js";

const results = contrastResults();

describe("token contrast (WCAG 2.x)", () => {
  it.each(results.map((r) => [`${r.theme} ${r.group}: ${r.fg} on ${r.bg}`, r] as const))("%s", (_, r) => {
    expect(r.ratio, `${r.fgHex} on ${r.bgHex}`).toBeGreaterThanOrEqual(r.min);
  });

  it("covers S2's minimums in both themes", () => {
    const has = (group: string, fg: string, bg: string, min: number) =>
      THEMES.every((theme) =>
        results.some(
          (r) => r.theme === theme && r.group === group && r.fg === fg && r.bg === bg && r.min === min,
        ),
      );
    for (const fg of ["ink", "ink-2", "ink-3", "pencil", "pencil-faint", "jade-text", "canary-text", "red"]) {
      for (const bg of ["ground", "plate", "plate-2"])
        expect(has("console-text", fg, bg, 4.5), `${fg}/${bg}`).toBe(true);
    }
    expect(has("statement", "ink", "plate", 7)).toBe(true);
    expect(has("statement", "ink-2", "plate", 7)).toBe(true);
    expect(has("face", "on-jade", "jade", 4.5)).toBe(true);
    expect(has("face", "on-canary", "canary", 4.5)).toBe(true);
    expect(has("face", "on-red-face", "red-face", 4.5)).toBe(true);
    expect(has("face", "slab-chalk-label", "slab-chalk-face", 4.5)).toBe(true);
    expect(has("face", "slab-jade-label", "slab-jade-face", 4.5)).toBe(true);
    for (const bg of ["ground", "plate", "plate-2"]) {
      expect(has("non-text", "pod", bg, 3)).toBe(true);
      expect(has("hatch", "hatch", bg, 1.8)).toBe(true);
    }
    expect(has("non-text", "jade-flush-border", "plate", 3)).toBe(true);
    expect(has("non-text", "canary-border", "plate", 3)).toBe(true);
  });

  it("reproduces the design's published ratios (a check on the contrast maths)", () => {
    expect(contrast(RESOLVED.tablea.ink.hex, RESOLVED.tablea.ground.hex)).toBeCloseTo(15.2, 0);
    expect(contrast(RESOLVED.adlaw.ink.hex, RESOLVED.adlaw.plate.hex)).toBeCloseTo(18.0, 0);
    expect(contrast(RESOLVED.adlaw["ink-2"].hex, RESOLVED.adlaw.plate.hex)).toBeCloseTo(9.4, 1);
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrast("#777777", "#777777")).toBe(1);
  });

  it("statement copy meets 7:1 in both themes, as S2 measured (7.64 Tablea, 9.36 Adlaw for ink-2)", () => {
    expect(contrast(RESOLVED.tablea["ink-2"].hex, RESOLVED.tablea.plate.hex)).toBeCloseTo(7.64, 1);
    expect(contrast(RESOLVED.adlaw["ink-2"].hex, RESOLVED.adlaw.plate.hex)).toBeCloseTo(9.36, 1);
  });

  it("every rule names only colours that exist, with a reason", () => {
    for (const rule of CONTRAST_RULES) {
      expect(rule.why.length).toBeGreaterThan(5);
      for (const name of [...rule.fg, ...rule.bg]) expect(RESOLVED.tablea).toHaveProperty([name]);
    }
  });
});
