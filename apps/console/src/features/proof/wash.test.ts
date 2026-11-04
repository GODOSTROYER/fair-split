// Proof's ground (UI gate round 2): plate, with no wash at all, since a check result never glows and colour sits
// only where it means something; and the wide column from a laptop up. jsdom applies no stylesheet: this reads
// proof.css as a browser would cascade it.

import { describe, expect, it } from "vitest";
import { cascaded, readRules } from "../../test/css.js";

const rules = readRules("src/features/proof/proof.css");
const WIDE = { width: 1920, motion: "full" } as const;

describe("Proof's ground", () => {
  it("is plate with no wash behind the hero", () => {
    const surface = document.createElement("div");
    surface.className = "fsc-surface fsc-surface--proof";
    document.body.append(surface);
    expect(cascaded(rules, surface, "background", WIDE)).toBeUndefined();
    expect(cascaded(rules, surface, "background-image", WIDE)).toBeUndefined();
    expect(cascaded(rules, surface, "background-color", WIDE)).toBe("var(--fs-plate)");
    surface.remove();
  });

  it("reads as one wide sheet from 1120 px: a 1040 px column, the verdict beside the money", () => {
    const surface = document.createElement("div");
    surface.className = "fsc-surface fsc-surface--proof";
    document.body.append(surface);
    expect(cascaded(rules, surface, "--fs-proof-column", WIDE)).toBe("1040px");
    expect(cascaded(rules, surface, "--fs-proof-column", { width: 1280, motion: "full" })).toBe("1040px");
    expect(cascaded(rules, surface, "--fs-proof-column", { width: 1024, motion: "full" })).toBeUndefined();
    surface.remove();
  });
});
