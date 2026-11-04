// Proof's morning wash sits behind the hero only (decision.md §5, §8). --fs-wash is two gradients, so the size,
// place and repeat must be longhands that every layer takes; the shorthand sized only its last layer and let the
// jade one run down the whole page, behind the checks and the tables. jsdom applies no stylesheet: this reads
// proof.css as a browser would cascade it.

import { describe, expect, it } from "vitest";
import { cascaded, readRules } from "../../test/css.js";

const rules = readRules("src/features/proof/proof.css");
const WIDE = { width: 1920, motion: "full" } as const;

describe("Proof's morning wash", () => {
  it("is sized, placed and kept from repeating on every layer, behind the hero's 960 px only", () => {
    const surface = document.createElement("div");
    surface.className = "fsc-surface fsc-surface--proof";
    document.body.append(surface);
    expect(cascaded(rules, surface, "background", WIDE)).toBeUndefined();
    expect(cascaded(rules, surface, "background-image", WIDE)).toBe("var(--fs-wash)");
    expect(cascaded(rules, surface, "background-size", WIDE)).toBe("100% 960px");
    expect(cascaded(rules, surface, "background-repeat", WIDE)).toBe("no-repeat");
    expect(cascaded(rules, surface, "background-color", WIDE)).toBe("var(--fs-plate)");
    surface.remove();
  });

  it("reads as one wide card from 1440 px: a 1040 px column, the seal beside the money", () => {
    const surface = document.createElement("div");
    surface.className = "fsc-surface fsc-surface--proof";
    document.body.append(surface);
    expect(cascaded(rules, surface, "--fs-proof-column", WIDE)).toBe("1040px");
    expect(cascaded(rules, surface, "--fs-proof-column", { width: 1280, motion: "full" })).toBeUndefined();
    surface.remove();
  });
});
