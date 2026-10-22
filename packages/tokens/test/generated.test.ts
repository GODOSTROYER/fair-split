// The generated files are committed, so Vite and Metro never depend on build order. This test renders them
// in memory and fails when the committed copies are stale (S2 §2.1).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_DIR, renderAll } from "../src/generate.js";
import * as native from "../src/generated/tokens.native.js";
import { COLOUR_NAMES, THEMES } from "../src/tokens.js";

const files = renderAll();
const here = dirname(fileURLToPath(import.meta.url));
const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

describe("generated files", () => {
  it.each(Object.keys(files))("%s is fresh (run the tokens build script if this fails)", (name) => {
    const onDisk = readFileSync(resolve(GENERATED_DIR, name), "utf8");
    expect(onDisk).toBe(files[name]);
  });

  it("theme.web.css declares every --fs- colour under both [data-theme] selectors, with OKLCH upgrades", () => {
    const css = files["theme.web.css"] ?? "";
    expect(css).toContain(':root,\n[data-theme="tablea"] {');
    expect(css).toContain('[data-theme="adlaw"] {');
    expect(css).toContain("@supports (color: oklch(0 0 0))");
    for (const name of COLOUR_NAMES) {
      const count = css.split(`--fs-${name}:`).length - 1;
      expect(count, name).toBe(4);
    }
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--fs-spring-land: linear(");
    expect(css).not.toMatch(/monospace/);
  });

  it("tokens.native.ts exports both themes in hex with camelCase keys", () => {
    for (const theme of THEMES) {
      const t = native.themes[theme];
      expect(t.name).toBe(theme);
      for (const name of COLOUR_NAMES) {
        expect(t.colours[camel(name) as keyof typeof t.colours]).toMatch(/^(#[0-9A-F]{6}|rgba\([\d, .]+\))$/);
      }
    }
    expect(native.defaultTheme.name).toBe("adlaw");
    expect(native.type.amountHero).toMatchObject({
      fontFamily: "FSSans-CondXBold",
      fontSize: 48,
      lineHeight: 52,
    });
  });

  it("every font file the CSS and the native module name exists in assets/fonts", () => {
    const css = `${files["fonts.css"]}${files["fonts-proof.css"]}`;
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] ?? "");
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) expect(existsSync(resolve(GENERATED_DIR, url)), url).toBe(true);
    for (const font of Object.values(native.fonts)) {
      expect(existsSync(resolve(here, "../../../assets/fonts/native", `${font}.ttf`)), font).toBe(true);
    }
  });

  it("the peso face shares the main face's descriptors, so browsers compose them", () => {
    const css = files["fonts.css"] ?? "";
    const faces = css.split("@font-face").filter((f) => f.includes('"FS Sans"'));
    expect(faces).toHaveLength(2);
    const descriptors = (face: string) => face.match(/font-(weight|stretch): [^;]+;/g);
    expect(descriptors(faces[1] ?? "")).toEqual(descriptors(faces[0] ?? ""));
    expect(faces[1]).toContain("unicode-range: U+20B1;");
  });

  it("tailwind.css resets every theme namespace so Tailwind is layout only", () => {
    expect(files["tailwind.css"]).toContain("--*: initial;");
    expect(files["tailwind.css"]).toContain("--spacing: 0.25rem;");
  });

  it("contrast.json reports no failing pair", () => {
    const report = JSON.parse(files["contrast.json"] ?? "{}") as { failing: number; pairs: number };
    expect(report.failing).toBe(0);
    expect(report.pairs).toBeGreaterThan(90);
  });
});
