#!/usr/bin/env node
// Runs secretlint or Biome over the staged files, in batches.
//
// lefthook's {staged_files} puts every staged path on one command line, and on Windows
// `pnpm exec` goes through cmd.exe, which rejects lines over 8,191 characters. A merge commit
// can stage hundreds of files, so this script reads the staged list from git itself and calls
// each tool's JavaScript entry with node directly, 40 files at a time.
//
// Both tools get every staged file. Biome decides for itself which it checks, exactly as CI's `biome ci .` does
// (Markdown, YAML and CSS as well as code and JSON), and skips the rest: --files-ignore-unknown=true for file
// types it has no support for, --no-errors-on-unmatched for a batch in which nothing is left to check.
//
// Usage (from the repo root, as lefthook runs it): node tools/run-staged.mjs secretlint|biome

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOLS = {
  secretlint: { pkg: "secretlint", bin: "secretlint", args: [] },
  biome: {
    pkg: "@biomejs/biome",
    bin: "biome",
    args: ["check", "--files-ignore-unknown=true", "--no-errors-on-unmatched"],
  },
};

const BATCH = 40;

const name = process.argv[2];
const tool = TOOLS[name];
if (!tool) {
  console.error(`usage: node tools/run-staged.mjs ${Object.keys(TOOLS).join("|")}`);
  process.exit(2);
}

const pkgDir = join(process.cwd(), "node_modules", tool.pkg);
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const binEntry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin[tool.bin];
const binPath = join(pkgDir, binEntry);

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

for (let i = 0; i < staged.length; i += BATCH) {
  const batch = staged.slice(i, i + BATCH);
  const result = spawnSync(process.execPath, [binPath, ...tool.args, ...batch], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
