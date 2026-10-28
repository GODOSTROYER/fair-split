// biome.json keeps `biome ci .` on the repository's own files. A local checkout has folders that CI's fresh clone
// never has: turbo's task cache (.turbo/cache/*-meta.json and *-manifest.json, compact JSON that the formatter
// rejects), dist, coverage, .expo, node_modules and the other artefact folders .gitignore lists. Biome must ignore
// every one of them, and docs/spec, while an unformatted file anywhere else still fails. Biome runs with the real
// biome.json over a throwaway tree in the OS temp dir.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const biomeBin = resolve(repoRoot, "node_modules/@biomejs/biome/bin/biome");
const read = (rel) => readFileSync(resolve(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

const UNFORMATTED_JSON = '{"a":1,\n"b":2}\n';
const UNFORMATTED_TS = "export   const   x={a:1}\n";
/** What turbo 2 writes next to each cached task (`<hash>.tar.zst`): one line of compact JSON each. */
const TURBO_CACHE = {
  ".turbo/cache/0ec9fd195913249d-meta.json": '{"hash":"0ec9fd195913249d","duration":16685}',
  ".turbo/cache/0ec9fd195913249d-manifest.json":
    '{"version":1,"files":{"packages/db/.turbo/turbo-typecheck.log":{"size":108,"is_dir":false}},"order":[]}',
  ".turbo/runs/2Q1x0T9.json": '{"id":"2Q1x0T9","version":"1","turboVersion":"2.11.10"}',
};

/**
 * The folders .gitignore ignores, as places to plant files. "x/" matches at any depth, so it is planted at the root
 * and inside a package; a pattern with an inner slash ("media/raw/") is anchored and planted as written.
 */
function gitignoredFolders() {
  const folders = [];
  for (const line of read(".gitignore")
    .split("\n")
    .map((l) => l.trim())) {
    if (!line.endsWith("/") || line.startsWith("#") || line.startsWith("!")) continue;
    const folder = line.replace(/^\/|\/$/g, "");
    if (/[*?[\]]/.test(folder)) throw new Error(`plant a sample for the glob folder ${line} in this test`);
    folders.push(folder);
    if (!line.slice(0, -1).includes("/")) folders.push(`packages/sample/${folder}`);
  }
  return folders;
}

let tree;
const plant = (rel, text) => {
  mkdirSync(dirname(join(tree, rel)), { recursive: true });
  writeFileSync(join(tree, rel), text);
};

/** Runs `biome ci .` in the tree; returns the exit code and the paths of every file with a diagnostic. */
function biomeCi() {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS; // keep the reporter the one asked for, also on CI
  const r = spawnSync(
    process.execPath,
    [biomeBin, "ci", "--reporter=json", "--colors=off", "--max-diagnostics=500", "."],
    { cwd: tree, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 },
  );
  const start = r.stdout.indexOf("{");
  if (start === -1) throw new Error(`biome printed no JSON report:\n${r.stdout}\n${r.stderr}`);
  const report = JSON.parse(r.stdout.slice(start));
  const paths = [...new Set(report.diagnostics.map((d) => d.location?.path?.replace(/\\/g, "/")))];
  return {
    status: r.status,
    paths: paths.sort(),
    checked: report.summary.unchanged + report.summary.changed,
  };
}

beforeAll(() => {
  tree = mkdtempSync(join(tmpdir(), "fs-biome-ignores-"));
  copyFileSync(resolve(repoRoot, "biome.json"), join(tree, "biome.json"));
  for (const [rel, text] of Object.entries(TURBO_CACHE)) plant(rel, text);
  plant("packages/sample/.turbo/turbo-test.log", "cache miss, executing 0ec9fd195913249d\n");
  for (const folder of [...gitignoredFolders(), "docs/spec"]) {
    plant(`${folder}/sample.json`, UNFORMATTED_JSON);
    plant(`${folder}/sample.ts`, UNFORMATTED_TS);
  }
  plant("packages/sample/src/clean.ts", "export const clean = 1;\n");
});
afterAll(() => {
  if (tree) rmSync(tree, { recursive: true, force: true });
});

describe("biome.json ignores generated folders", () => {
  it("the planted folders are .gitignore's own, turbo's cache, dist, coverage, .expo and node_modules among them", () => {
    const folders = gitignoredFolders();
    for (const f of [".turbo", "dist", "coverage", ".expo", "node_modules", "packages/sample/.turbo"]) {
      expect(folders).toContain(f);
    }
  });

  it("an unformatted file outside them still fails `biome ci`, and nothing inside them is reported", () => {
    plant("src/unformatted.json", UNFORMATTED_JSON);
    plant("src/unformatted.ts", UNFORMATTED_TS);
    try {
      const r = biomeCi();
      expect(r.paths).toEqual(["src/unformatted.json", "src/unformatted.ts"]);
      expect(r.status).toBe(1);
    } finally {
      rmSync(join(tree, "src"), { recursive: true, force: true });
    }
  }, 60_000);

  it("`biome ci` passes on a checkout whose .turbo cache and other generated folders hold unformatted files", () => {
    const r = biomeCi();
    expect(r.paths).toEqual([]);
    expect(r.status).toBe(0);
    expect(r.checked).toBeGreaterThanOrEqual(2); // biome.json and the clean source file, at least
  }, 60_000);
});
