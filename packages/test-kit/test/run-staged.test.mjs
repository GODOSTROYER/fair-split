// Tests for the pre-commit hook's runner, tools/run-staged.mjs, as lefthook.yml wires it (WS-QA owns all three).
// lefthook's {staged_files} used to put every staged path on one command line, and on Windows `pnpm exec` goes
// through cmd.exe, which rejects lines over 8,191 characters, so a large merge commit could not pass the secrets
// hook. The runner reads the staged files from git and calls each tool's JS entry with node, in batches.
// Each test builds a throwaway repository in the OS temp dir with this repo's lefthook.yml and hook tools, stages
// files and runs the hook with the pinned lefthook, as `git commit` does. Where a test must see the arguments a
// tool gets, stand-ins for secretlint and Biome log each call instead of checking anything.
// The Biome step used to get only the staged files matching OLD_BIOME_GLOB, while CI's `biome ci .` also checks
// Markdown, YAML, CSS and the rest, so an unformatted docs/adr/*.md passed the hook and failed CI at a merge. It now
// gets every staged file, and Biome itself skips what it does not check (--files-ignore-unknown=true).

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (rel) => readFileSync(resolve(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
const lefthookBin = resolve(repoRoot, "node_modules/lefthook/bin/index.js");

/** cmd.exe rejects a command line longer than this; the runner keeps every tool call under it. */
const CMD_EXE_LIMIT = 8191;
/** The Biome glob of the hook before the runner (lefthook.yml at 7cbcada^); the runner kept it until 68989d1. */
const OLD_BIOME_GLOB = "*.{ts,tsx,js,mjs,cjs,json}";
/** A fake classic GitHub token, assembled at run time so that no file in this repository holds one. */
const FAKE_TOKEN = ["gh", "p_", "FairSplitFakeToken".padEnd(36, "0")].join("");
const HOOK_FILES = [
  "lefthook.yml",
  "biome.json",
  "tools/run-staged.mjs",
  "tools/guard-env.mjs",
  ".secretlintrc.json",
  ".secretlintignore",
];
const GIT = [
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.autocrlf=false",
];

// Throwaway repositories live in the OS temp dir, never under packages/ (see check-ownership.test.mjs).
const tmpBase = mkdtempSync(join(tmpdir(), "fs-run-staged-"));
const noHooks = join(tmpBase, "no-hooks");
mkdirSync(noHooks);
const links = [];
afterAll(() => {
  for (const link of links) unlinkSync(link); // the link to this repo's node_modules, never what it points at
  rmSync(tmpBase, { recursive: true, force: true });
});

/** What the runner passes Biome before the staged files. */
const BIOME_ARGS = ["check", "--files-ignore-unknown=true", "--no-errors-on-unmatched"];

/** A stand-in tool: logs its arguments and an upper bound of its command line's length, then exits 0. */
const probe = (log) => `const { appendFileSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");
mkdirSync(dirname(${JSON.stringify(log)}), { recursive: true });
const length = process.argv.reduce((n, arg) => n + arg.length + 3, 0); // every argument quoted, plus a space
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), length }) + "\\n");
`;

/**
 * A repository with this repo's hook files committed. `tools` is "real" (a link to this repo's node_modules),
 * "fake" (stand-ins for secretlint and Biome, shaped like the real packages) or "none" (nothing installed).
 */
function makeRepo(tools) {
  const dir = mkdtempSync(join(tmpBase, "repo-"));
  const git = (...args) =>
    execFileSync("git", [...GIT, "-c", `core.hooksPath=${noHooks}`, ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const callLog = (tool) => join(dir, ".calls", `${tool}.jsonl`);
  git("init", "-q", "-b", "main");
  for (const file of HOOK_FILES) write(file, readFileSync(resolve(repoRoot, file)));
  // No trailing slash: on Linux the link below is a symlink, which a directory pattern does not match.
  write(".gitignore", "node_modules\n.calls/\nlefthook-local.yml\nold-hook.cjs\n");
  if (tools === "real") {
    const link = join(dir, "node_modules");
    symlinkSync(resolve(repoRoot, "node_modules"), link, "junction");
    links.push(link);
  } else if (tools === "fake") {
    write(
      "node_modules/secretlint/package.json",
      JSON.stringify({ name: "secretlint", bin: "./bin/secretlint.js" }),
    );
    write("node_modules/secretlint/bin/secretlint.js", probe(callLog("secretlint")));
    write(
      "node_modules/@biomejs/biome/package.json",
      JSON.stringify({ name: "@biomejs/biome", bin: { biome: "bin/biome" } }),
    );
    write("node_modules/@biomejs/biome/bin/biome", probe(callLog("biome")));
  }
  git("add", "-A");
  git("commit", "-q", "-m", "hook files");
  return {
    dir,
    git,
    write,
    staged: () => git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean),
    /** Every logged call of a stand-in tool, in order. */
    calls: (tool) =>
      existsSync(callLog(tool))
        ? readFileSync(callLog(tool), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
  };
}

/** Runs the repo's pre-commit hook (only `commands`, if given) with the pinned lefthook: { status, out }. */
function runHook(dir, commands = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^lefthook/i.test(k)));
  const r = spawnSync(
    process.execPath,
    [
      lefthookBin,
      "run",
      "pre-commit",
      "--no-auto-install",
      "--no-tty",
      "--colors",
      "off",
      ...commands.flatMap((c) => ["--command", c]),
    ],
    { cwd: dir, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 },
  );
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The `key: value` lines of one pre-commit command in lefthook.yml, quotes removed. */
function hookCommand(yml, name) {
  const lines = yml.split("\n");
  const start = lines.indexOf(`    ${name}:`);
  if (start === -1) return undefined;
  const fields = {};
  for (let i = start + 1; i < lines.length && /^ {6}\S/.test(lines[i]); i++) {
    const m = /^ {6}([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (m) fields[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return fields;
}

describe("lefthook.yml", () => {
  it("runs secretlint and Biome through the runner, so lefthook's own command line holds no file list", () => {
    const yml = readText("lefthook.yml");
    expect(hookCommand(yml, "secrets")).toEqual({ run: "node tools/run-staged.mjs secretlint" });
    // no glob: Biome gets every staged file and decides what it checks, as `biome ci .` does
    expect(hookCommand(yml, "biome")).toEqual({ run: "node tools/run-staged.mjs biome" });
  });
});

describe("the secrets hook through tools/run-staged.mjs", () => {
  it("a staged fake token fails the secrets hook through the runner, in the last of several batches too", () => {
    const r = makeRepo("real");
    for (let i = 0; i < 100; i++)
      r.write(`src/clean-${String(i).padStart(3, "0")}.ts`, `export const n = ${i};\n`);
    r.git("add", "-A");
    const clean = runHook(r.dir, ["secrets"]);
    expect(clean.status, clean.out).toBe(0);

    r.write("zz/leak.ts", `export const token = "${FAKE_TOKEN}";\n`);
    r.git("add", "-A");
    const leak = runHook(r.dir, ["secrets"]);
    expect(leak.status).not.toBe(0);
    expect(leak.out).toMatch(/zz[\\/]leak\.ts/);
    expect(leak.out).toContain("@secretlint/secretlint-rule-github");
    expect(leak.out).not.toContain(FAKE_TOKEN); // secretlint masks what it finds; the hook never prints it
  }, 120_000);

  it("fails closed when secretlint is not installed: a hook that cannot scan does not pass", () => {
    const r = makeRepo("none");
    r.write("src/a.ts", "export const a = 1;\n");
    r.git("add", "-A");
    const run = runHook(r.dir, ["secrets"]);
    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/secretlint/);
  }, 60_000);
});

describe("a merge commit's worth of staged files", () => {
  it("more than 300 staged paths do not exceed the command line: every tool call stays under 8,191", () => {
    const r = makeRepo("fake");
    // As long as the longest path tracked today (116 characters).
    const paths = Array.from(
      { length: 320 },
      (_, i) =>
        `packages/ai/src/read/smoke/fixtures/recordings/${createHash("sha256").update(String(i)).digest("hex")}.json`,
    ).sort();
    for (const p of paths) r.write(p, "{}\n");
    r.git("add", "-A");
    expect(r.staged()).toEqual(paths);
    expect(paths.join(" ").length).toBeGreaterThan(4 * CMD_EXE_LIMIT);

    const run = runHook(r.dir); // the whole hook: secrets, guard-env and biome
    expect(run.status, run.out).toBe(0);
    for (const [tool, prefix] of [
      ["secretlint", []],
      ["biome", BIOME_ARGS],
    ]) {
      const calls = r.calls(tool);
      expect(calls.length, tool).toBeGreaterThan(1);
      for (const call of calls) {
        expect(call.length, tool).toBeLessThanOrEqual(CMD_EXE_LIMIT);
        expect(call.args.slice(0, prefix.length), tool).toEqual(prefix);
      }
      // Every staged path, each exactly once.
      expect(calls.flatMap((c) => c.args.slice(prefix.length)).sort(), tool).toEqual(paths);
    }

    // guard-env still takes {staged_files}: lefthook splits that list itself, and checks the last file too.
    r.write("zz/.env.local", "NOT_A_SECRET=1\n");
    r.git("add", "-A");
    const blocked = runHook(r.dir, ["guard-env"]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.out).toContain("zz/.env.local: env files must never be committed");
  }, 120_000);
});

describe("the runner hands each tool the files the old {staged_files} hook did", () => {
  // The hook before the runner, as lefthook-local.yml commands beside the real ones; old-hook.cjs logs what it got.
  const OLD_HOOK = `pre-commit:
  commands:
    secrets-old:
      run: node old-hook.cjs secretlint-old {staged_files}
    biome-old:
      glob: "${OLD_BIOME_GLOB}"
      run: node old-hook.cjs biome-old {staged_files}
`;
  const CORPUS = [
    "a.ts",
    "b.tsx",
    "c.js",
    "d.mjs",
    "e.cjs",
    "f.json",
    "i.d.ts",
    "s.ts.json",
    ".json",
    ".hidden.ts",
    "src/deep/g.ts",
    "src/deep/h.json",
    "app/[id].tsx",
    "app/(tabs)/index.tsx",
    "with space.ts",
    "ünï.ts",
    "UPPER.TS",
    "Mixed.Json",
    "x.JS",
    "j.mts",
    "k.cts",
    "l.jsonc",
    "m.json5",
    "n.jsx",
    "o.md",
    "p.yaml",
    "q.ts.orig",
    "r.tsbuildinfo",
    "t.json.md",
    "dir.ts/readme.md",
    "noext",
  ];
  const got = {};

  beforeAll(() => {
    const r = makeRepo("fake");
    for (const f of ["keep/modified.ts", "keep/renamed-from.ts", "keep/deleted.ts", "keep/untouched.ts"]) {
      r.write(f, `export const file = ${JSON.stringify(f)};\n`);
    }
    r.git("add", "-A");
    r.git("commit", "-q", "-m", "files to modify, rename and delete");
    r.write("keep/modified.ts", 'export const file = "changed";\n');
    r.git("mv", "keep/renamed-from.ts", "keep/renamed-to.ts");
    r.git("rm", "-q", "keep/deleted.ts");
    for (const f of CORPUS) r.write(f, "{}\n");
    r.write("lefthook-local.yml", OLD_HOOK);
    r.write(
      "old-hook.cjs",
      `require("node:fs").mkdirSync(".calls", { recursive: true });
require("node:fs").appendFileSync(".calls/" + process.argv[2] + ".jsonl", JSON.stringify({ args: process.argv.slice(3) }) + "\\n");
`,
    );
    r.git("add", "-A");
    const run = runHook(r.dir, ["secrets", "biome", "secrets-old", "biome-old"]);
    if (run.status !== 0) throw new Error(run.out);
    const files = (tool, skip) =>
      r
        .calls(tool)
        .flatMap((c) => c.args.slice(skip))
        .sort();
    got.secretlint = files("secretlint", 0);
    got.secretlintOld = files("secretlint-old", 0);
    got.biome = files("biome", BIOME_ARGS.length);
    got.biomeOld = files("biome-old", 0);
  }, 120_000);

  it("secretlint gets exactly what the old hook passed: added, modified and renamed files, never deleted ones", () => {
    expect(got.secretlint).toEqual(got.secretlintOld);
    expect(got.secretlint).toEqual([...CORPUS, "keep/modified.ts", "keep/renamed-to.ts"].sort());
  });

  it("Biome gets every staged file secretlint gets, all the old glob passed among them; it skips the rest", () => {
    expect(got.biome).toEqual(got.secretlint);
    expect(got.biomeOld.filter((f) => !got.biome.includes(f))).toEqual([]);
    expect(got.biome).toEqual(
      expect.arrayContaining(["o.md", "p.yaml", "UPPER.TS", "Mixed.Json", "app/(tabs)/index.tsx", "noext"]),
    );
  });
});

describe("the Biome hook checks the files `biome ci .` checks", () => {
  // Biome's own formatting of each file: what `biome ci .` accepts.
  const FORMATTED = {
    "docs/adr/0099-fixture.md": "# A fixture ADR\n\nOne paragraph.\n",
    ".github/workflows/fixture.yaml": "name: fixture\non:\n  push:\n",
    "config/fixture.yml": "key: value\n",
    "src/UPPER.TS": "export const a = 1;\n",
    "styles/fixture.css": "a {\n  color: red;\n}\n",
  };
  const UNFORMATTED = {
    "docs/adr/0099-fixture.md": "# A fixture ADR\n\n\n\nOne paragraph.\n",
    ".github/workflows/fixture.yaml": "name:    fixture\non:\n    push:\n",
    "config/fixture.yml": "key:     value\n",
    "src/UPPER.TS": "export const a=1\n",
    "styles/fixture.css": "a{color:red}\n",
  };

  it("passes formatted files of every kind, and files Biome does not check (an image, no extension)", () => {
    const r = makeRepo("real");
    for (const [path, text] of Object.entries(FORMATTED)) r.write(path, text);
    r.write("assets/pixel.png", "\x89PNG\r\n");
    r.write("LICENSE-NOTICE", "no extension\n");
    r.git("add", "-A");
    const run = runHook(r.dir, ["biome"]);
    expect(run.status, run.out).toBe(0);
    // every formatted file was checked, not skipped; the image and the extensionless file were skipped
    expect(run.out).toMatch(new RegExp(`Checked ${Object.keys(FORMATTED).length} files`));
  }, 120_000);

  it.each(Object.keys(UNFORMATTED))(
    "fails an unformatted staged %s, as `biome ci .` would",
    (path) => {
      const r = makeRepo("real");
      r.write(path, UNFORMATTED[path]);
      r.git("add", "-A");
      const run = runHook(r.dir, ["biome"]);
      expect(run.status, run.out).not.toBe(0);
      expect(run.out).toMatch(new RegExp(path.split("/").map(escapeRegExp).join("[\\\\/]")));
    },
    120_000,
  );
});

describe("CONTRIBUTING.md", () => {
  it("documents the runner, why it batches, and how to run the hook by hand", () => {
    const contributing = readText("CONTRIBUTING.md");
    expect(contributing).toContain("`tools/run-staged.mjs`");
    expect(contributing).toMatch(/8,191 characters/);
    expect(contributing).toContain("node tools/run-staged.mjs secretlint");
    expect(contributing).toContain("corepack pnpm exec lefthook run pre-commit");
    expect(contributing).toContain("--files-ignore-unknown=true");
  });
});
