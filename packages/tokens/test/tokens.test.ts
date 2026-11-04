import { describe, expect, it } from "vitest";
import { hexToOklch, mixHex, oklchToHex } from "../src/color.js";
import { RESOLVED } from "../src/resolve.js";
import {
  COLOUR_NAMES,
  COLOUR_ROLES,
  COLOURS,
  FONT_STACKS,
  HOLLOW,
  LAYOUT,
  M3_ROLES,
  MATERIALS,
  NUMERAL_ROLES,
  RADII,
  SHADOWS,
  SPACE,
  TEXT_FLOORS,
  THEME_INFO,
  THEMES,
  TYPE_ROLES,
  type TypeRole,
  WASH,
} from "../src/tokens.js";

const oklab = (hex: string) => {
  const [l, c, h] = hexToOklch(hex);
  return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const;
};
const distance = (a: string, b: string) => {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

describe("colour source", () => {
  it.each(THEMES)("%s defines every colour, each with a role", (theme) => {
    for (const name of COLOUR_NAMES) {
      expect(COLOURS[theme]).toHaveProperty([name]);
      expect(COLOUR_ROLES[name].length).toBeGreaterThan(5);
    }
  });

  it.each(THEMES)("%s: every OKLCH triple rounds to its hex fallback", (theme) => {
    for (const name of COLOUR_NAMES) {
      const spec = COLOURS[theme][name];
      if (spec.kind === "mix") continue;
      expect(oklchToHex(spec.oklch), `${theme} ${name}`).toBe(spec.hex);
    }
  });

  it("Gabii's own OKLCH for its ground is #090D18 (night navy)", () => {
    expect(oklchToHex([0.161, 0.0243, 268.23])).toBe("#090D18");
  });

  it("resolves the v2 mixes over plate in sRGB, opaque, to decision.md's hex", () => {
    expect(RESOLVED.tablea["canary-wash"].hex).toBe(mixHex("#FFA41B", "#10172A", 0.14));
    expect(RESOLVED.tablea["canary-wash"].hex).toBe("#312B28");
    expect(RESOLVED.tablea["jade-wash"].hex).toBe("#16343C");
    expect(RESOLVED.tablea["red-wash"].hex).toBe("#2D2333");
    expect(RESOLVED.tablea["pencil-wash"].hex).toBe("#222A3D");
    expect(RESOLVED.tablea["pod-wash"].hex).toBe("#242748");
    expect(RESOLVED.adlaw["jade-wash"].hex).toBe(mixHex("#14CC90", "#FFFFFF", 0.14));
    expect(RESOLVED.adlaw["jade-wash"].hex).toBe("#DEF8EF");
    // Round 2: a held row has no cream wash on Hayag; the amber rule carries the hold.
    expect(RESOLVED.adlaw["canary-wash"].hex).toBe("#FFFFFF");
    expect(RESOLVED.adlaw["pencil-wash"].hex).toBe("#EDEFF1");
    expect(RESOLVED.adlaw["pod-wash"].hex).toBe("#F1EEFC");
    for (const theme of THEMES) {
      for (const name of ["jade-wash", "pencil-wash", "canary-wash", "red-wash", "pod-wash"] as const) {
        expect(RESOLVED[theme][name].alpha).toBe(1);
      }
    }
  });

  it("keeps v2's contrast fixes (decision.md §3)", () => {
    expect(RESOLVED.adlaw["steel-line"].hex).toBe("#7E8898");
    // Round 2: one amber for holds (the dot, the arc, the 3 px rule), no darker brownish edge.
    expect(RESOLVED.adlaw["canary-border"].hex).toBe("#FFA41B");
    expect(RESOLVED.adlaw.pod.hex).toBe("#4A2FD6");
    expect(RESOLVED.adlaw.canary.hex).toBe("#FFA41B");
    expect(RESOLVED.adlaw["ink-3"].hex).toBe("#5A6476");
    expect(RESOLVED.tablea["ink-3"].hex).toBe("#8E98AE");
    expect(RESOLVED.adlaw["rule-strong"].hex).toBe("#CBD2DC");
  });

  it("has no brown: amber is one bright token, never text, and hold copy is ink (UI gate round 2)", () => {
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        const [l, c, h] = RESOLVED[theme][name].oklch;
        // A warm hue (orange to olive) that is dark and saturated reads brown on screen.
        const brown = c > 0.04 && h > 40 && h < 100 && l < 0.7;
        expect(brown, `${theme} ${name} (L ${l.toFixed(2)}, C ${c.toFixed(3)}, h ${h.toFixed(1)})`).toBe(
          false,
        );
      }
    }
    expect(RESOLVED.adlaw["canary-text"].hex).toBe(RESOLVED.adlaw.ink.hex);
    expect(RESOLVED.adlaw["canary-border"].hex).toBe(RESOLVED.adlaw.canary.hex);
  });

  it("no green button: the money slab wears the indigo primary face in both themes (UI gate round 2)", () => {
    for (const theme of THEMES) {
      expect(RESOLVED[theme]["slab-jade-face"].hex).toBe(RESOLVED[theme]["slab-chalk-face"].hex);
      expect(RESOLVED[theme]["slab-jade-label"].hex).toBe(RESOLVED[theme]["slab-chalk-label"].hex);
      expect(RESOLVED[theme]["slab-jade-face"].hex).not.toBe(RESOLVED[theme].jade.hex);
    }
  });

  it("has no brown: every surface, rule and material is cool (hue 230 to 290) or neutral", () => {
    const surfaces = [
      "ground",
      "plate",
      "plate-2",
      "rule",
      "rule-strong",
      "hatch",
      "steel-face",
      "steel-line",
      "bezel",
      "ink",
      "ink-2",
      "ink-3",
    ] as const;
    for (const theme of THEMES) {
      for (const name of surfaces) {
        const [, c, h] = RESOLVED[theme][name].oklch;
        const cool = c < 0.005 || (h > 230 && h < 290);
        expect(cool, `${theme} ${name} (chroma ${c.toFixed(3)}, hue ${h.toFixed(1)})`).toBe(true);
      }
    }
  });

  it("keeps saturated indigo for a person's hand only: pod and the one primary face (both slabs)", () => {
    // Round 2: the money slab is the same flat indigo primary as every decision (a person's hand presses it).
    const hand = new Set<string>([
      "pod",
      "slab-chalk-face",
      "slab-chalk-right",
      "slab-chalk-bottom",
      "slab-jade-face",
      "slab-jade-right",
      "slab-jade-bottom",
    ]);
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        const [, c, h] = RESOLVED[theme][name].oklch;
        const indigo = c > 0.1 && h > 260 && h < 340;
        if (indigo) expect(hand.has(name), `${theme} ${name}`).toBe(true);
      }
      for (const name of hand) {
        const [, c, h] = RESOLVED[theme][name as (typeof COLOUR_NAMES)[number]].oklch;
        expect(c > 0.1 && h > 260 && h < 340, `${theme} ${name}`).toBe(true);
      }
    }
  });

  it("keeps every colour role clear of PayPal's blues (#003087, #0070E0, #009CDE), the indigo slab's lip excepted", () => {
    // The indigo slab's lip (-right) and 1 px under-edge (-bottom) are the face's own shadow: a sliver, never a
    // surface, text or a face anyone presses, so they may darken toward navy (decision.md §6, §8: ballpoint
    // #4A2FD6 itself stays 13.6 from PayPal blue). Every other role keeps the 0.1 OKLab distance.
    const exceptions = new Set([
      "adlaw slab-chalk-right", // #3722B0, 0.087 from #003087
      "adlaw slab-chalk-bottom", // #29188A, 0.054 from #003087
      "tablea slab-chalk-bottom", // #2E1E94, 0.055 from #003087
      // Round 2: the money slab shares the indigo primary's shades.
      "adlaw slab-jade-right",
      "adlaw slab-jade-bottom",
      "tablea slab-jade-bottom",
    ]);
    const near: string[] = [];
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        for (const brand of ["#003087", "#0070E0", "#009CDE"]) {
          if (distance(RESOLVED[theme][name].hex, brand) <= 0.1) near.push(`${theme} ${name}`);
        }
      }
    }
    expect(near.sort()).toEqual([...exceptions].sort());
  });

  it("keeps marigold 15° of hue from PayPal's button yellow at 84 (decision.md §3)", () => {
    const paypalYellowHue = hexToOklch("#FFC439")[2];
    expect(paypalYellowHue).toBeCloseTo(84, -1);
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        const [l, c, h] = RESOLVED[theme][name].oklch;
        // Only bright, saturated faces could read as PayPal's button; dark marigold text cannot.
        if (c < 0.1 || l < 0.7) continue;
        expect(Math.abs(h - paypalYellowHue), `${theme} ${name}`).toBeGreaterThan(12);
      }
    }
    expect(RESOLVED.tablea.canary.oklch[2]).toBeCloseTo(68.9, 0);
  });
  it("jade and canary have no Material 3 role, and primary is ink", () => {
    const roles = Object.values(M3_ROLES) as string[];
    expect(roles).not.toContain("jade");
    expect(roles).not.toContain("canary");
    expect(M3_ROLES.primary).toBe("ink");
  });
});

describe("type, space and layout", () => {
  it("three numeral roles (round 3): money is the plain grotesk, ids the code-like tabular set, one instrument", () => {
    for (const role of NUMERAL_ROLES.money) {
      expect(TYPE_ROLES[role].numerals, role).toBe("proportional");
    }
    for (const role of NUMERAL_ROLES.id) {
      expect(["tabular", "hash"], role).toContain(TYPE_ROLES[role].numerals);
      expect(TYPE_ROLES[role].size, role).toBeGreaterThanOrEqual(TEXT_FLOORS.id);
    }
    expect(NUMERAL_ROLES.instrument).toEqual([]);
    const roled = new Set<string>([...NUMERAL_ROLES.money, ...NUMERAL_ROLES.id]);
    for (const [name, role] of Object.entries(TYPE_ROLES) as [string, TypeRole][]) {
      if (role.numerals) expect(roled.has(name), name).toBe(true);
    }
  });

  it("secondary words are 13 px or more on the console, ids 12 px or more (round 3)", () => {
    expect(TEXT_FLOORS).toEqual({ secondary: 13, id: 12 });
    for (const role of ["caption", "label", "body"] as const) {
      expect(TYPE_ROLES[role].size, role).toBeGreaterThanOrEqual(TEXT_FLOORS.secondary);
    }
    expect(TYPE_ROLES.micro.size).toBeGreaterThanOrEqual(TEXT_FLOORS.id);
  });

  it("one numeral voice: every money hero, figure, micro label and hash is FS Sans 87.5 at 500 (round 2)", () => {
    for (const role of ["amount-hero", "amount-l", "figure", "micro", "hash"] as const) {
      expect(TYPE_ROLES[role], role).toMatchObject({ family: "ui", stretch: 87.5, weight: 500 });
      expect(TYPE_ROLES[role].native, role).toBe("FSSans-SemiCondMedium");
    }
  });

  it("two type voices: FS Sans and Atkinson for statements; no outline face and no stencil (round 3)", () => {
    const families = new Set(Object.values(TYPE_ROLES).map((r) => r.family));
    expect([...families].sort()).toEqual(["statement", "ui"]);
    expect(FONT_STACKS.hollow).toBe(FONT_STACKS.ui);
    expect(FONT_STACKS.mark).toBe(FONT_STACKS.ui);
  });

  it("money is never bold, and only headers, buttons, statement status, stamps and the mark reach 600", () => {
    for (const [name, role] of Object.entries(TYPE_ROLES)) {
      if (name.startsWith("amount")) expect(role.weight, name).toBeLessThanOrEqual(500);
      const heavy = ["display", "slab", "stamp", "mark", "statement-status"].includes(name);
      if (!heavy) expect(role.weight, name).toBeLessThan(600);
    }
  });

  it("adds the v2 roles: display, lede and statement-status (decision.md §7)", () => {
    expect(TYPE_ROLES.display).toMatchObject({ stretch: 112.5, weight: 600, size: 40, line: 44 });
    expect(TYPE_ROLES.lede).toMatchObject({ stretch: 100, weight: 430, size: 16, line: 24 });
    expect(TYPE_ROLES["statement-status"]).toMatchObject({
      family: "statement",
      weight: 700,
      size: 18,
      line: 22,
    });
    expect(TYPE_ROLES["title-1"]).toMatchObject({ stretch: 100, weight: 560, size: 26, line: 32 });
    expect(TYPE_ROLES["title-2"]).toMatchObject({ stretch: 100, weight: 560, size: 20, line: 24 });
    expect(TYPE_ROLES.figure.weight).toBe(500);
    expect(TYPE_ROLES.label.weight).toBe(520);
    expect(TYPE_ROLES.caption).toMatchObject({ weight: 500, size: 13, app: { size: 12 } });
  });

  it("statement prose never drops below 18 px, and the hero amount caps app font scaling at 1.5×", () => {
    expect(TYPE_ROLES["statement-body"].size).toBeGreaterThanOrEqual(18);
    expect(TYPE_ROLES["amount-hero"].app.maxFontSizeMultiplier).toBe(1.5);
  });

  it("hollow amounts start at 28 px with a 1.25 px stroke", () => {
    expect(HOLLOW).toEqual({ minSize: 28, stroke: 1.25 });
    expect(TYPE_ROLES["amount-hero"].size).toBeGreaterThanOrEqual(HOLLOW.minSize);
    expect(TYPE_ROLES["amount-l"].size).toBeGreaterThanOrEqual(HOLLOW.minSize);
  });

  it("the season and lot marks are the id role at 13 px: the stencil face is retired (round 3)", () => {
    expect(TYPE_ROLES.mark).toMatchObject({ family: "ui", stretch: 87.5, weight: 500, size: 13 });
    expect(TYPE_ROLES.mark.numerals).toBe("hash");
    expect(TYPE_ROLES.mark.proof).toMatchObject({ size: 13 });
    for (const role of Object.values(TYPE_ROLES)) expect(role.family).not.toBe("mark");
  });

  it("uses the 4-based space scale and one radius scale (0, 2, cell 6, control 12, card 16, panel 24, pill)", () => {
    expect([...SPACE]).toEqual([2, 4, 8, 12, 16, 24, 32, 48, 64, 96]);
    expect(RADII).toEqual({ 0: 0, 2: 2, cell: 6, control: 12, card: 16, panel: 24, pill: 999 });
  });

  it("has e1 to e3, paper and the halo in both themes, one wash each, and no noise (decision.md §8)", () => {
    for (const theme of THEMES) {
      expect(Object.keys(SHADOWS[theme]).sort()).toEqual(["e1", "e2", "e3", "halo", "paper"]);
      expect(WASH[theme]).toMatch(/^radial-gradient\(/);
    }
    expect(SHADOWS.adlaw.halo).toBe("0 0 0 6px rgb(20 204 144 / 0.16)");
    expect(MATERIALS.noise.opacity).toBe(0);
    expect(MATERIALS.stamp.size).toBe(20);
  });

  it("names both slots for v2: Hayag (day) is adlaw, Gabii (night) is tablea", () => {
    expect(THEME_INFO.adlaw).toMatchObject({ scheme: "light", display: "Hayag (day)" });
    expect(THEME_INFO.tablea).toMatchObject({ scheme: "dark", display: "Gabii (night)" });
  });

  it("meets the app's touch-target floors", () => {
    expect(LAYOUT.app.target).toBeGreaterThanOrEqual(48);
    expect(LAYOUT.app.primary).toBe(56);
    expect(LAYOUT.app.hero).toBe(64);
  });
});
