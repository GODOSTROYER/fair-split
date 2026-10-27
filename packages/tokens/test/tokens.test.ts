import { describe, expect, it } from "vitest";
import { hexToOklch, mixHex, oklchToHex } from "../src/color.js";
import { RESOLVED } from "../src/resolve.js";
import {
  COLOUR_NAMES,
  COLOUR_ROLES,
  COLOURS,
  HOLLOW,
  LAYOUT,
  M3_ROLES,
  RADII,
  SPACE,
  THEMES,
  TYPE_ROLES,
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

  it("the design's own OKLCH for Tablea's ground is #201712", () => {
    expect(oklchToHex([0.214, 0.017, 50])).toBe("#201712");
  });

  it("resolves S2's mixes over plate in sRGB, opaque", () => {
    expect(RESOLVED.tablea["canary-wash"].hex).toBe(mixHex("#F2DA4E", "#2A1F18", 0.12));
    expect(RESOLVED.tablea["jade-wash"].hex).toBe(mixHex("#2FD3A0", "#2A1F18", 0.18));
    expect(RESOLVED.adlaw["jade-wash"].hex).toBe(mixHex("#2FD3A0", "#FFFFFF", 0.16));
    expect(RESOLVED.adlaw["pencil-wash"].hex).toBe(mixHex("#4C5761", "#FFFFFF", 0.1));
    for (const theme of THEMES) {
      for (const name of ["jade-wash", "pencil-wash", "canary-wash", "red-wash"] as const) {
        expect(RESOLVED[theme][name].alpha).toBe(1);
      }
    }
  });

  it("keeps S2's contrast corrections", () => {
    expect(RESOLVED.tablea["ink-3"].hex).toBe("#9C9085");
    expect(RESOLVED.adlaw["ink-3"].hex).toBe("#6F665E");
    expect(RESOLVED.tablea.hatch.hex).toBe("#624E41");
    expect(RESOLVED.adlaw.hatch.hex).toBe("#B7B0A7");
    expect(RESOLVED.tablea["pencil-faint"].hex).toBe("#909498");
    expect(RESOLVED.adlaw["pencil-faint"].hex).toBe("#5E6871");
    expect(RESOLVED.adlaw["canary-border"].hex).toBe("#7F6200");
  });

  it("Tablea's ground is visibly brown, never neutral black", () => {
    const [l, c, h] = hexToOklch(RESOLVED.tablea.ground.hex);
    expect(l).toBeGreaterThan(0.2);
    expect(c).toBeGreaterThan(0.015);
    expect(h).toBeGreaterThan(40);
    expect(h).toBeLessThan(60);
  });

  it("uses no purple or indigo anywhere", () => {
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        const [, c, h] = RESOLVED[theme][name].oklch;
        const purple = c > 0.03 && h > 260 && h < 340;
        expect(purple, `${theme} ${name}`).toBe(false);
      }
    }
  });

  it("stays clear of PayPal's blues (#003087, #0070E0, #009CDE)", () => {
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        for (const brand of ["#003087", "#0070E0", "#009CDE"]) {
          const d = distance(RESOLVED[theme][name].hex, brand);
          expect(d, `${theme} ${name} vs ${brand}`).toBeGreaterThan(0.1);
        }
      }
    }
  });

  it("keeps canary at hue 99, away from PayPal's button yellow at 84 (design §2.2)", () => {
    const paypalYellowHue = hexToOklch("#FFC439")[2];
    expect(paypalYellowHue).toBeCloseTo(84, -1);
    for (const theme of THEMES) {
      for (const name of COLOUR_NAMES) {
        const [l, c, h] = RESOLVED[theme][name].oklch;
        // Only bright, saturated faces could read as PayPal's button; dark canary text cannot.
        if (c < 0.1 || l < 0.7) continue;
        expect(Math.abs(h - paypalYellowHue), `${theme} ${name}`).toBeGreaterThan(12);
      }
    }
    expect(RESOLVED.tablea.canary.oklch[2]).toBeCloseTo(99.4, 0);
  });

  it("jade and canary have no Material 3 role, and primary is ink", () => {
    const roles = Object.values(M3_ROLES) as string[];
    expect(roles).not.toContain("jade");
    expect(roles).not.toContain("canary");
    expect(M3_ROLES.primary).toBe("ink");
  });
});

describe("type, space and layout", () => {
  it("money, kilos and hashes use tabular figures", () => {
    for (const role of ["amount-hero", "amount-l", "figure", "hash"] as const) {
      expect(TYPE_ROLES[role].figures).toBe(true);
    }
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

  it("the stencil face is for marks only and has no native cut", () => {
    expect(TYPE_ROLES.mark.family).toBe("mark");
    expect(TYPE_ROLES.mark.native).toBeNull();
    const others = Object.entries(TYPE_ROLES).filter(([n]) => n !== "mark");
    for (const [, role] of others) expect(role.family).not.toBe("mark");
  });

  it("uses the 4-based space scale and only radii 0 and 2", () => {
    expect([...SPACE]).toEqual([2, 4, 8, 12, 16, 24, 32, 48, 64, 96]);
    expect(Object.values(RADII)).toEqual([0, 2]);
  });

  it("meets the app's touch-target floors", () => {
    expect(LAYOUT.app.target).toBeGreaterThanOrEqual(48);
    expect(LAYOUT.app.primary).toBe(56);
    expect(LAYOUT.app.hero).toBe(64);
  });
});
