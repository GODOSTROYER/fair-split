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
  MONO_ROLES,
  NATIVE_FONTS,
  NATIVE_MONO,
  RADII,
  SHADOWS,
  SPACE,
  TEXT_FLOORS,
  THEME_INFO,
  THEMES,
  TYPE_ROLES,
  TYPE_STEPS,
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
  it("five size steps (UI gate round 3): every role sits on one, on the console and on the phone", () => {
    expect(TYPE_STEPS.web).toEqual({ id: 12, label: 14, body: 16, title: 24, hero: 56 });
    expect(TYPE_STEPS.app).toEqual({ id: 13, label: 15, body: 17, title: 24, hero: 48 });
    const web = new Set<number>(Object.values(TYPE_STEPS.web));
    const app = new Set<number>(Object.values(TYPE_STEPS.app));
    for (const [name, role] of Object.entries(TYPE_ROLES) as [string, TypeRole][]) {
      expect(web.has(role.size), `${name} ${role.size}`).toBe(true);
      expect(app.has(role.app.size), `${name} app ${role.app.size}`).toBe(true);
      expect(role.line, name).toBeGreaterThanOrEqual(role.size);
    }
    expect(new Set(Object.values(TYPE_ROLES).map((r) => r.size)).size).toBeLessThanOrEqual(5);
  });

  it("one family + mono: FS Sans with tabular figures for every role; the mono only for ids, hashes and marks", () => {
    for (const [name, role] of Object.entries(TYPE_ROLES) as [string, TypeRole][]) {
      const mono = (MONO_ROLES as readonly string[]).includes(name);
      expect(role.family, name).toBe(mono ? "mono" : "ui");
      if (mono) {
        expect(role.size, name).toBe(TYPE_STEPS.web.id);
        expect(role.native, name).toBe(NATIVE_MONO);
      } else if (name !== "stamp") {
        expect(role.numerals, name).toBe("tabular");
      }
    }
    expect(FONT_STACKS.ui).toMatch(/^"FS Sans"/);
    expect(FONT_STACKS.mono).toMatch(/monospace$/);
    expect(FONT_STACKS.mark).toBe(FONT_STACKS.mono);
    expect(FONT_STACKS.statement).toBe(FONT_STACKS.ui);
    expect(FONT_STACKS.hollow).toBe(FONT_STACKS.ui);
  });

  it("no Atkinson, stencil, outline or dot-matrix face anywhere in the product's tokens", () => {
    const named = [...Object.values(FONT_STACKS), ...Object.values(NATIVE_FONTS)].join(" ");
    expect(named).not.toMatch(/Atkinson|Stencil|Hollow|Matrix/i);
    expect(Object.values(TYPE_ROLES).every((r) => r.native !== null)).toBe(true);
  });

  it("text floors (round 3): secondary words 13 px or more, ids 12, body text and statements 16", () => {
    expect(TEXT_FLOORS).toEqual({ secondary: 13, id: 12, body: 16 });
    for (const role of ["caption", "label", "micro", "figure"] as const) {
      expect(TYPE_ROLES[role].size, role).toBeGreaterThanOrEqual(TEXT_FLOORS.secondary);
    }
    for (const role of MONO_ROLES) expect(TYPE_ROLES[role].size, role).toBeGreaterThanOrEqual(TEXT_FLOORS.id);
    for (const role of ["body", "lede", "statement-body"] as const) {
      expect(TYPE_ROLES[role].size, role).toBeGreaterThanOrEqual(TEXT_FLOORS.body);
      expect(TYPE_ROLES[role].app.size, role).toBeGreaterThanOrEqual(TEXT_FLOORS.body);
    }
    expect(MATERIALS.statementMin).toBe(TEXT_FLOORS.body);
  });

  it("one money style: every money hero and figure is FS Sans 87.5 at 500, the phone's semi-condensed cut", () => {
    for (const role of ["hero", "amount-hero", "amount-l", "figure"] as const) {
      expect(TYPE_ROLES[role], role).toMatchObject({ family: "ui", stretch: 87.5, weight: 500 });
      expect(TYPE_ROLES[role].native, role).toBe("FSSans-SemiCondMedium");
    }
    expect(TYPE_ROLES["amount-hero"]).toMatchObject({ size: 56, line: 60 });
    expect(TYPE_ROLES["amount-hero"].app).toMatchObject({ size: 48, line: 52, maxFontSizeMultiplier: 1.5 });
  });

  it("money is never bold, and only titles, headings, buttons, statement status and stamps reach 600", () => {
    const heavy = new Set([
      "title",
      "heading",
      "display",
      "title-1",
      "title-2",
      "slab",
      "stamp",
      "statement-lead",
      "statement-status",
    ]);
    for (const [name, role] of Object.entries(TYPE_ROLES)) {
      if (name.startsWith("amount") || name === "hero") expect(role.weight, name).toBeLessThanOrEqual(500);
      if (heavy.has(name)) expect(role.weight, name).toBeGreaterThanOrEqual(600);
      else expect(role.weight, name).toBeLessThan(600);
    }
  });

  it("the aliases keep their names on the five steps", () => {
    expect(TYPE_ROLES.display).toMatchObject({ size: 24, weight: 600 });
    expect(TYPE_ROLES["title-1"]).toMatchObject({ size: 24, line: 30, weight: 600 });
    expect(TYPE_ROLES["title-2"]).toMatchObject({ size: 16, line: 24, weight: 600 });
    expect(TYPE_ROLES.lede).toMatchObject({ size: 16, line: 24, weight: 430 });
    expect(TYPE_ROLES.caption).toMatchObject({ size: 14, line: 20, app: { size: 15 } });
    expect(TYPE_ROLES.hash).toMatchObject({ family: "mono", size: 12 });
    expect(TYPE_ROLES.mark).toMatchObject({ family: "mono", size: 12 });
  });

  it("the outline face stays retired: HOLLOW is kept only so consumers compile", () => {
    expect(HOLLOW).toEqual({ minSize: 28, stroke: 1.25 });
  });

  it("uses the 4-based space scale and one radius scale (0, 2, cell 6, control 12, card 16, panel 24, pill)", () => {
    expect([...SPACE]).toEqual([2, 4, 8, 12, 16, 20, 24, 32, 48, 64, 96]);
    expect(RADII).toEqual({ 0: 0, 2: 2, cell: 6, control: 12, card: 16, panel: 24, pill: 999 });
  });

  it("has e1 to e3, paper and the halo in both themes; no wash on Hayag and no noise (round 3)", () => {
    for (const theme of THEMES) {
      expect(Object.keys(SHADOWS[theme]).sort()).toEqual(["e1", "e2", "e3", "halo", "paper"]);
    }
    expect(WASH.adlaw).toBe("none");
    expect(WASH.tablea).toMatch(/^radial-gradient\(/);
    expect(SHADOWS.adlaw.halo).toBe("0 0 0 6px rgb(20 204 144 / 0.16)");
    expect(MATERIALS.noise.opacity).toBe(0);
    expect(MATERIALS.stamp.size).toBe(22);
  });

  it("names both slots for v2: Hayag (day) is adlaw, Gabii (night) is tablea", () => {
    expect(THEME_INFO.adlaw).toMatchObject({ scheme: "light", display: "Hayag (day)" });
    expect(THEME_INFO.tablea).toMatchObject({ scheme: "dark", display: "Gabii (night)" });
  });

  it("meets the app's touch-target floors; the phone rail, the toast and the seal have one size each", () => {
    expect(LAYOUT.app.target).toBeGreaterThanOrEqual(48);
    expect(LAYOUT.app.primary).toBe(56);
    expect(LAYOUT.app.hero).toBe(64);
    expect(LAYOUT.console).toMatchObject({ phoneRail: 56, toast: 40, seal: 180 });
    expect(LAYOUT.app.seal).toBe(LAYOUT.console.seal);
  });
});
