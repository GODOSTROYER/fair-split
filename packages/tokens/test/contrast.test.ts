// CI gate (design §2.7, S2 §2.2): the build fails if any declared colour pair drops below its target.
// 4.5:1 console text, 7:1 statement copy, 4.5:1 text on faces and washes, 3:1 non-text, 1.8:1 hatching.

import { describe, expect, it } from "vitest";
import { contrast, hexToOklch } from "../src/color.js";
import { contrastResults, RESOLVED } from "../src/resolve.js";
import { CONTRAST_RULES, THEMES } from "../src/tokens.js";

const results = contrastResults();

/** OKLab distance ×100 between two hex colours (the ΔE decision.md §10 quotes). */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [l, c, h] = hexToOklch(hex);
    return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const;
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

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

  it("covers design direction v2's six rules in both themes (ADR-0016, decision.md §10)", () => {
    const has = (group: string, fg: string, bg: string, min: number) =>
      THEMES.every((theme) =>
        results.some(
          (r) => r.theme === theme && r.group === group && r.fg === fg && r.bg === bg && r.min === min,
        ),
      );
    expect(has("wash", "ink", "pod-wash", 4.5)).toBe(true);
    expect(has("wash", "ink-2", "pod-wash", 4.5)).toBe(true);
    expect(has("wash", "jade-text", "jade-wash", 4.5)).toBe(true);
    expect(has("wash", "canary-text", "canary-wash", 4.5)).toBe(true);
    for (const bg of ["ground", "plate", "plate-2"]) expect(has("non-text", "steel-line", bg, 3)).toBe(true);
    expect(has("non-text", "canary-border", "canary-wash", 3)).toBe(true);
    expect(has("non-text", "pod", "pod-wash", 3)).toBe(true);
  });

  it("reproduces the design's published ratios (a check on the contrast maths)", () => {
    expect(contrast(RESOLVED.tablea.ink.hex, RESOLVED.tablea.ground.hex)).toBeCloseTo(17.9, 1);
    expect(contrast(RESOLVED.adlaw.ink.hex, RESOLVED.adlaw.plate.hex)).toBeCloseTo(18.7, 1);
    expect(contrast(RESOLVED.adlaw["ink-2"].hex, RESOLVED.adlaw.plate.hex)).toBeCloseTo(9.8, 1);
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrast("#777777", "#777777")).toBe(1);
  });

  it("statement copy meets 7:1 in both themes, as decision.md §10 measured (10.74 Gabii, 9.81 Hayag for ink-2)", () => {
    expect(contrast(RESOLVED.tablea["ink-2"].hex, RESOLVED.tablea.plate.hex)).toBeCloseTo(10.74, 1);
    expect(contrast(RESOLVED.adlaw["ink-2"].hex, RESOLVED.adlaw.plate.hex)).toBeCloseTo(9.81, 1);
  });

  it("Hayag only: both slab lips reach 3:1 on plate, so the lip reads as the slab's depth on light", () => {
    const plate = RESOLVED.adlaw.plate.hex;
    expect(contrast(RESOLVED.adlaw["slab-jade-right"].hex, plate)).toBeGreaterThanOrEqual(3);
    expect(contrast(RESOLVED.adlaw["slab-chalk-right"].hex, plate)).toBeGreaterThanOrEqual(3);
  });

  it("keeps jade, marigold and ballpoint at least ΔE 7 from PayPal's colours (decision.md §10)", () => {
    const paypal = ["#0070E0", "#003087", "#009CDE", "#FFC439"];
    const nearest = (hex: string) => Math.min(...paypal.map((p) => deltaE(hex, p)));
    for (const theme of THEMES) {
      for (const name of ["jade", "canary", "pod"] as const) {
        expect(nearest(RESOLVED[theme][name].hex), `${theme} ${name}`).toBeGreaterThanOrEqual(7);
      }
    }
    expect(nearest(RESOLVED.adlaw.pod.hex)).toBeCloseTo(13.6, 1);
    expect(nearest(RESOLVED.adlaw.canary.hex)).toBeCloseTo(7.4, 1);
    expect(nearest(RESOLVED.adlaw.jade.hex)).toBeCloseTo(20.6, 1);
  });

  it("every rule names only colours that exist, with a reason", () => {
    for (const rule of CONTRAST_RULES) {
      expect(rule.why.length).toBeGreaterThan(5);
      for (const name of [...rule.fg, ...rule.bg]) expect(RESOLVED.tablea).toHaveProperty([name]);
    }
  });
});
