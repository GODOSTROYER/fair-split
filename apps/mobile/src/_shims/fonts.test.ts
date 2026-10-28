import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import appConfig from "../../app.config";
import { FIGURE_VARIANT, fontFamily, pesoFace } from "./fonts";

const app = fileURLToPath(new URL("../../", import.meta.url));
const nativeDir = resolve(app, "../../assets/fonts/native");
const fileOf = (family: string) => join(nativeDir, `${family}.ttf`);

/** WS-DS's build report: what `cut_fonts.py` read back from every file it wrote (sizes, ₱ coverage, names). */
const report = JSON.parse(readFileSync(resolve(app, "../../assets/fonts/fonts.report.json"), "utf8")) as {
  sizes: Record<string, number>;
  checks: Record<string, { peso: boolean; zeroContours: number | null; names: Record<string, string> }>;
};
const checkOf = (family: string) => report.checks[`native/${family}.ttf`];

const FS_SANS = [fontFamily.amount, fontFamily.figure, fontFamily.ui, fontFamily.strong];
const ATKINSON = [fontFamily.statement, fontFamily.statementBold];

describe("the app sets type in WS-DS's cuts (design §2.3, S2.3), not stand-ins", () => {
  it("gives each role its FS Sans cut: amounts 75/800, figures 87.5/500, UI 100/400, slabs and titles 112.5/700", () => {
    expect(fontFamily).toEqual({
      amount: "FSSans-CondXBold",
      figure: "FSSans-SemiCondMedium",
      ui: "FSSans-Regular",
      strong: "FSSans-SemiExpBold",
      statement: "AtkinsonNext-Regular",
      statementBold: "AtkinsonNext-Bold",
    });
  });

  it("names every family after a file in assets/fonts/native that is the file WS-DS built and checked", () => {
    for (const family of Object.values(fontFamily)) {
      expect(existsSync(fileOf(family)), family).toBe(true);
      expect(statSync(fileOf(family)).size, family).toBe(report.sizes[`native/${family}.ttf`]);
      // The expo-font plugin takes the family from the file name on Android and from the font on iOS: both agree.
      expect(checkOf(family)?.names["6"], family).toBe(family);
      expect(checkOf(family)?.names["1"], family).toBe(family);
    }
  });

  it("embeds exactly those files in the Android build (expo-font plugin)", () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    const plugin = config.plugins?.find((p) => Array.isArray(p) && p[0] === "expo-font") as
      | [string, { fonts: string[] }]
      | undefined;
    const embedded = (plugin?.[1].fonts ?? []).map((f) => resolve(app, f)).sort();
    expect(embedded).toEqual(Object.values(fontFamily).map(fileOf).sort());
    expect(JSON.stringify(config.plugins)).not.toMatch(/expo-google-fonts|MonaSans/);
  });

  it("loads the same files on the web export, under the same family names", () => {
    const source = readFileSync(join(app, "src/_shims/font-sources.web.ts"), "utf8");
    const entries = [...source.matchAll(/"([\w-]+)":\s*require\("([^"]+)"\)/g)].map((m) => ({
      family: m[1] ?? "",
      file: resolve(join(app, "src/_shims"), m[2] ?? ""),
    }));
    expect(entries.map((e) => e.family).sort()).toEqual(Object.values(fontFamily).sort());
    for (const e of entries) expect(e.file, e.family).toBe(fileOf(e.family));
  });

  it("uses the cuts' own peso (the grafted Noto ₱); only Atkinson prose borrows it from the figure face", () => {
    for (const family of FS_SANS) {
      expect(checkOf(family)?.peso, family).toBe(true);
      expect(pesoFace(family), family).toBeNull();
    }
    for (const family of ATKINSON) {
      expect(checkOf(family)?.peso, family).toBe(false);
      expect(pesoFace(family), family).toBe(fontFamily.figure);
    }
  });

  it("keeps the slashed zero: tabular figures only, never ss08 (Mona's straight-bar zero)", () => {
    expect([...FIGURE_VARIANT]).toEqual(["tabular-nums"]);
    // The cuts' default zero is the slashed tabular one (three contours: the bowl, its counter split by the slash).
    for (const family of FS_SANS) expect(checkOf(family)?.zeroContours, family).toBe(3);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name.name) && !/\.test\.ts$/.test(name.name)) {
          const text = readFileSync(path, "utf8");
          if (/ss08|stylistic-eight|MonaSans_/.test(text)) offenders.push(path);
        }
      }
    };
    walk(join(app, "src"));
    expect(offenders).toEqual([]);
  });
});
