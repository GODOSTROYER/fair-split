// dist/index.js is what Render runs. Build it with the real tsdown config (into a temp dir) and check what
// it still imports at runtime: no workspace package (they export TypeScript source), and no bare `zod` (the
// paypal-* packages need zod 3 and the API zod 4; each must stay with its importer).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleConfig } from "../tsdown.config.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const OUT = mkdtempSync(join(tmpdir(), "fs-api-dist-"));

const jsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => join(e.parentPath, e.name));

/** Bare specifiers the emitted code still imports: top-level import statements and dynamic `import("…")`. */
function externalImports(code: string): Set<string> {
  const out = new Set<string>();
  const patterns = [
    /^import\b[^"';]*?\bfrom\s*["']([^"']+)["']/gm,
    /^import\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const spec = m[1] as string;
      if (!spec.startsWith(".") && !spec.startsWith("/")) out.add(spec);
    }
  }
  return out;
}

describe("tsdown bundle of fs-api", () => {
  beforeAll(async () => {
    await build({ ...bundleConfig, cwd: APP, outDir: OUT, config: false, sourcemap: false });
  }, 120_000);
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

  it("emits index.js, the render.yaml start command", () => {
    expect(readdirSync(OUT)).toContain("index.js");
  });

  it("inlines every @fairsplit/* package and both zod majors; only real npm packages stay external", () => {
    const external = new Set<string>();
    for (const file of jsFiles(OUT))
      for (const s of externalImports(readFileSync(file, "utf8"))) external.add(s);
    const bare = [...external].filter((s) => !s.startsWith("node:"));
    expect(bare.filter((s) => s.startsWith("@fairsplit/"))).toEqual([]);
    expect(bare.filter((s) => s === "zod" || s.startsWith("zod/"))).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const declared = Object.keys(pkg.dependencies);
    for (const s of bare) {
      const name = s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : (s.split("/")[0] as string);
      expect(declared, `${s} is imported at runtime but not a dependency of @fairsplit/api`).toContain(name);
    }
  });
});
