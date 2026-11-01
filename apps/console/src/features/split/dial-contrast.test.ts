// The PENDING mass-balance dial is drawn dimmed while slip 0462 waits, but its caption ("Mass balance", the
// value, "Limit ±2.0%") is text and keeps the token contrast (S2's ink-3 ≥ 4.5:1): an opacity on the whole visual
// took the 12 px captions to 3.1:1. jsdom applies no CSS, so this reads the stylesheet: any dimming rule for the
// PENDING dial reaches the drawing (its svg) and never the figure or its figcaption.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs in the package's folder (apps/console).
const css = readFileSync(resolve(process.cwd(), "src/features/split/split.css"), "utf8");

function rulesFor(source: string, needle: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? "").trim();
    if (selector.includes(needle)) out.push({ selector, body: m[2] ?? "" });
  }
  return out;
}

describe("the PENDING dial's dimming", () => {
  it("dims only the drawing, never the caption text", () => {
    const dimming = rulesFor(css, '[data-status="PENDING"]').filter((r) => /opacity\s*:/.test(r.body));
    expect(dimming.length).toBeGreaterThan(0);
    for (const rule of dimming) {
      for (const selector of rule.selector.split(",")) {
        expect(selector.trim()).toMatch(/\bsvg$/);
      }
    }
  });
});
