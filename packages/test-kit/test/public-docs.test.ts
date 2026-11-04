// S1/S2: the README and docs/devpost.md hold no placeholder but the marked TODO lines the merger fills (the hosted
// URL, the GIF, the APK), and the README's synthetic-data table quotes media/manifest.json's hashes exactly.
// E-19 (e19-copy-lint.test.ts) covers their wording and figures; this covers what E-19 cannot see.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

/** The only placeholders public copy may carry until the merger fills them (S1/S2 brief). */
const ALLOWED_TODO = /^\s*(?:- )?\*\*TODO \(merger\): [^*]*\b(?:hosted|GIF|APK)\b[^*]*\*\*\s*$/;

/** Every line of `text` that reads as a placeholder. */
const placeholders = (text: string): string[] =>
  text
    .split("\n")
    .filter((l) => /\bTODO\b|\bTBD\b|\bFIXME\b|_Planned\b|\(planned\)|To be summarised/i.test(l));

describe("public docs", () => {
  it("the README and docs/devpost.md carry only the marked TODO lines: hosted URL, GIF, APK", () => {
    for (const file of ["README.md", "docs/devpost.md"]) {
      for (const line of placeholders(read(file))) expect(line, file).toMatch(ALLOWED_TODO);
    }
  });

  it("the placeholder rule refuses anything else", () => {
    expect(placeholders("_Planned:_ diagram.")).toHaveLength(1);
    expect("_Planned:_ diagram.").not.toMatch(ALLOWED_TODO);
    expect("**TODO (merger): the CI badge.**").not.toMatch(ALLOWED_TODO);
    expect("**TODO (merger): the hosted Judge Mode URL goes here.**").toMatch(ALLOWED_TODO);
    expect("- **TODO (merger): Android APK link and its SHA-256.**").toMatch(ALLOWED_TODO);
  });

  it("the README's synthetic-data table quotes each image's prompt and master hash from media/manifest.json", () => {
    const manifest = JSON.parse(read("media/manifest.json")) as {
      assets: Record<
        string,
        { id: string; prompt: { file: string; sha256: string }; master: { sha256: string } }
      >;
    };
    const readme = read("README.md");
    const assets = Object.values(manifest.assets);
    expect(assets.length).toBeGreaterThan(10);
    for (const a of assets) {
      const row = readme.split("\n").find((l) => l.startsWith(`| \`${a.id}\``));
      expect(row, a.id).toBeDefined();
      expect(row).toContain(`(media/${a.prompt.file})`);
      expect(row).toContain(`\`${a.prompt.sha256.slice(0, 12)}\``);
      expect(row).toContain(`\`${a.master.sha256.slice(0, 12)}\``);
    }
  });
});
