/**
 * The tokens shim may not drift from WS-DS's generated module (ADR-0016). The app does not depend on
 * @fairsplit/tokens yet, so this reads packages/tokens/src/generated/tokens.native.ts as text: every colour role of
 * both slots, the radii and the display names must equal the shim's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layout, radius, type ThemeName, themes, typeSteps } from "./tokens.native";

const GENERATED = fileURLToPath(
  new URL("../../../../packages/tokens/src/generated/tokens.native.ts", import.meta.url),
);
const source = readFileSync(GENERATED, "utf8");

/** The `colours: { … }` entries of one exported theme in the generated module. */
function generatedColours(theme: ThemeName): Record<string, string> {
  const start = source.indexOf(`export const ${theme}: FsTheme = {`);
  expect(start, theme).toBeGreaterThanOrEqual(0);
  const block = source.slice(start, source.indexOf("\n};", start));
  const colours = block.slice(
    block.indexOf("colours: {"),
    block.indexOf("\n  },", block.indexOf("colours: {")),
  );
  const out: Record<string, string> = {};
  for (const m of colours.matchAll(/^\s+([a-zA-Z0-9]+): "([^"]+)",$/gm)) out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

describe("tokens shim against @fairsplit/tokens' generated native module", () => {
  it.each(["adlaw", "tablea"] as const)(
    "%s: every generated colour role is in the shim, with the same value",
    (theme) => {
      const generated = generatedColours(theme);
      expect(Object.keys(generated).length).toBeGreaterThanOrEqual(47);
      const shim = themes[theme].color as unknown as Record<string, string>;
      for (const [role, value] of Object.entries(generated))
        expect(shim[role], `${theme} ${role}`).toBe(value);
    },
  );

  it.each(["adlaw", "tablea"] as const)("%s: the slab faces match the slab colour roles", (theme) => {
    const g = generatedColours(theme);
    const t = themes[theme];
    expect(t.slab.chalk).toEqual({
      face: g.slabChalkFace,
      edgeRight: g.slabChalkRight,
      edgeBottom: g.slabChalkBottom,
      label: g.slabChalkLabel,
    });
    expect(t.slab.jade).toEqual({
      face: g.slabJadeFace,
      edgeRight: g.slabJadeRight,
      edgeBottom: g.slabJadeBottom,
      label: g.slabJadeLabel,
    });
  });

  it("keeps the generated radii and display names (Hayag is adlaw, Gabii is tablea)", () => {
    const radii = /export const radii = \{([^}]+)\}/.exec(source)?.[1] ?? "";
    const value = (key: string) => Number(new RegExp(`\\b${key}: (\\d+)`).exec(radii)?.[1]);
    expect(radius).toEqual({
      none: value("r0"),
      plate: value("r2"),
      cell: value("cell"),
      control: value("control"),
      card: value("card"),
      panel: value("panel"),
      pill: value("pill"),
    });
    expect(source).toContain('display: "Hayag (day)"');
    expect(themes.adlaw.display).toBe("Hayag (day)");
    expect(themes.tablea.display).toBe("Gabii (night)");
    expect(themes.adlaw.dark).toBe(false);
  });

  it("draws the seal at the generated layout's size (round 3: 180 on the Chair's phone and on Approve)", () => {
    const generated = Number(/export const layout = \{[^}]*\bseal: (\d+)/.exec(source)?.[1]);
    expect(layout.seal).toBe(generated);
    expect(layout.seal).toBe(180);
  });

  it("round 4: the co-sign seal, the status pill and the fades are the generated layout's", () => {
    const block = /export const layout = \{([^}]+)\}/.exec(source)?.[1] ?? "";
    const value = (key: string) => Number(new RegExp(`\\b${key}: (\\d+)`).exec(block)?.[1]);
    expect(layout.cosignSeal).toBe(value("cosignSeal"));
    expect(layout.statusChip).toBe(value("statusChip"));
    expect(layout.fade).toBe(value("fade"));
    expect(layout).toMatchObject({ cosignSeal: 140, statusChip: 32, fade: 24 });
  });

  it("sets type on the generated five steps (round 3: id 13, label 15, body 17, title 24, hero 48)", () => {
    const block = /export const typeSteps = \{([^}]+)\}/.exec(source)?.[1] ?? "";
    const generated = Object.fromEntries(
      [...block.matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(typeSteps).toEqual(generated);
  });
});
