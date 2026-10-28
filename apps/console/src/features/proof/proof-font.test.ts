// S2.11: Proof (W-PF-01, and the brand's view W-BR-01) loads its fonts in ≤80 KB: the FSSans-Proof subset, not the
// console's 120 KB variable face. jsdom loads no fonts, so this reads the stylesheets: Proof's column names a face
// of its own built on the subset, and nothing in it asks for a width the subset does not have (75-100%).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const proof = read("src/features/proof/proof.css");
const brand = read("src/features/brand/brand.css");

describe("Proof's face", () => {
  it("is the Proof subset under its own family, never the console's variable face", () => {
    const faces = [...proof.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    const own = faces.filter((f) => f.includes('"FS Sans Proof"'));
    expect(own.some((f) => f.includes("FSSans-Proof.woff2"))).toBe(true);
    expect(own.some((f) => f.includes("FSSans-VF.woff2"))).toBe(false);
    const root = /\n\.pf \{([^}]*)\}/.exec(proof)?.[1] ?? "";
    expect(root).toMatch(/--fs-font-ui:\s*"FS Sans Proof"/);
    expect(root).not.toMatch(/--fs-font-ui:[^;]*"FS Sans"[,;]/);
  });

  it("asks for no width the subset lacks", () => {
    for (const css of [proof, brand]) {
      for (const m of css.matchAll(/font-stretch:\s*([\d.]+)%/g)) {
        expect(Number(m[1])).toBeLessThanOrEqual(100);
      }
    }
  });
});
