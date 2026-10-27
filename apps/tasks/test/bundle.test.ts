// The built entries are what Render runs. These tests build them with the real tsdown config and
// run them, so a workspace import that would break `node dist/index.js` fails here first.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, type UserConfig } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";
import { runUnderFakeHost } from "../../../tools/lib/fake-workflow-host.js";
import { WORKFLOW_TASK_NAMES } from "../src/policy.js";
import { DB_PING_TASK, PING_TASK } from "../src/workflow.js";
import { bundleConfig, ENTRIES } from "../tsdown.config.js";
import { OUTBOX_ID } from "./helpers.js";

const APP = join(REPO_ROOT, "apps/tasks");
const DIST = join(APP, "dist");

const jsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => join(e.parentPath, e.name));

/** Static or dynamic imports of a workspace package left in emitted code. */
const WORKSPACE_IMPORT = /(?:from\s*|import\s*\(\s*|import\s+)["']@fairsplit\//;

describe("tsdown bundle of the fs-tasks entries", () => {
  beforeAll(async () => {
    await build({ ...bundleConfig, cwd: APP, config: false });
  }, 120_000);

  it("emits dist/index.js, dist/cron.js and dist/inline.js (render.yaml start commands)", () => {
    const top = readdirSync(DIST).filter((f) => f.endsWith(".js"));
    expect(top.sort()).toEqual(
      Object.keys(ENTRIES)
        .map((e) => `${e}.js`)
        .sort(),
    );
  });

  it("inlines every @fairsplit/* package: no workspace import survives in the output", () => {
    // The entry really imports one (the contracts shim's namespace import of @fairsplit/contracts).
    const shim = readFileSync(join(APP, "src/_shims/contracts.ts"), "utf8");
    expect(shim).toMatch(/from "@fairsplit\/contracts"/);
    for (const file of jsFiles(DIST)) expect(readFileSync(file, "utf8"), file).not.toMatch(WORKSPACE_IMPORT);
  });

  it("dist/index.js registers the Workflows tasks under the fake workflow host", async () => {
    const r = await runUnderFakeHost({
      entry: "apps/tasks/dist/index.js",
      cwd: REPO_ROOT,
      env: { PP_ENV: "sandbox" },
      mode: "register",
    });
    expect(r.exitCode).toBe(0);
    expect(r.registered?.map((t) => t.name)).toEqual([...WORKFLOW_TASK_NAMES, PING_TASK, DB_PING_TASK]);
  });

  it("dist/index.js runs a task through the shared chunks (invoke, wiring)", async () => {
    const r = await runUnderFakeHost({
      entry: "apps/tasks/dist/index.js",
      cwd: REPO_ROOT,
      env: { PP_ENV: "sandbox" },
      mode: "run",
      taskName: "extract",
      input: [OUTBOX_ID],
    });
    expect(r.result).toMatchObject({ status: "failed", code: "NOT_WIRED" });
  });

  it("dist/cron.js --plan runs as a plain node process", () => {
    const r = spawnSync(
      process.execPath,
      ["apps/tasks/dist/cron.js", "--plan", "--at=2026-10-24T02:07:00Z"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, LOG_LEVEL: "info" },
        encoding: "utf8",
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("reconcile:nightly:2026-10-24");
  });
});

// A package shaped like every @fairsplit/* package once WS-CORE lands: TypeScript source behind
// `exports`, with `.js` relative specifiers. Proves the config, not just today's empty contracts.
// Its `./assets` entry reads files next to its source the way packages/ai (prompts) and packages/db
// (migrations) do, so a built entry fails unless every inlined module still finds its own folder.
describe("bundle config against a TypeScript-source workspace package", () => {
  let dir = "";
  const pkg = () => join(dir, "node_modules/@fairsplit/probe");
  const WHERE_TS = [
    'import { fileURLToPath } from "node:url";',
    "export const where = () => ({",
    "  dirname: import.meta.dirname,",
    "  filename: import.meta.filename,",
    "  main: import.meta.main,",
    "});",
    "// packages/eval's CLI guard: it must stay false when this module runs inside another entry.",
    "export const ranAsCli = (): boolean =>",
    "  Boolean(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);",
    "export function fail(): never {",
    '  throw new Error("probe failure");',
    "}",
    "",
  ].join("\n");
  /** packages/ai's pattern (read/prompts.ts): a folder next to the module, one file per promptV. */
  const promptReader = (fn: string) =>
    [
      'import { readFileSync } from "node:fs";',
      'const PROMPTS_DIR = new URL("./prompts/", import.meta.url);',
      `export const ${fn} = (name: string): string =>`,
      '  readFileSync(new URL(name + ".md", PROMPTS_DIR), "utf8").trim();',
      "",
    ].join("\n");

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fs-bundle-probe-"));
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "@fairsplit/probe",
        type: "module",
        exports: { ".": "./src/index.ts", "./assets": "./src/assets.ts" },
      }),
      "src/index.ts": 'export { answer } from "./answer.js";\n',
      "src/answer.ts": "export const answer: number = 42;\n",
      "src/assets.ts": [
        'export { readPrompt } from "./read/prompts.js";',
        'export { rateCardPrompt } from "./ratecard/read.js";',
        'export { migrations } from "./migrate.js";',
        'export { fail, ranAsCli, where } from "./where.js";',
        "",
      ].join("\n"),
      "src/read/prompts.ts": promptReader("readPrompt"),
      "src/read/prompts/a.v1.md": "read: prompt A\n",
      // The same file name in another module's folder: bundled naively, both folders are dist/prompts/.
      "src/ratecard/read.ts": promptReader("rateCardPrompt"),
      "src/ratecard/prompts/a.v1.md": "rate card: prompt A\n",
      // packages/db's pattern (migrate.ts): a folder beside src/.
      "src/migrate.ts": [
        'import { readdirSync } from "node:fs";',
        'import { fileURLToPath } from "node:url";',
        'export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));',
        "export const migrations = (): string[] => readdirSync(MIGRATIONS_DIR).sort();",
        "",
      ].join("\n"),
      "migrations/0000_init.sql": "select 1;\n",
      "migrations/0001_schema.sql": "select 2;\n",
      "src/where.ts": WHERE_TS,
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(pkg(), file)), { recursive: true });
      writeFileSync(join(pkg(), file), text);
    }
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "probe-app",
        type: "module",
        dependencies: { "@fairsplit/probe": "workspace:*" },
      }),
    );
    writeFileSync(
      join(dir, "entry.ts"),
      'import { answer } from "@fairsplit/probe";\nconsole.log("answer=" + String(answer));\n',
    );
    writeFileSync(join(dir, "raw.mjs"), 'import { answer } from "@fairsplit/probe";\nconsole.log(answer);\n');
    writeFileSync(
      join(dir, "assets.ts"),
      [
        'import { fail, migrations, ranAsCli, rateCardPrompt, readPrompt, where } from "@fairsplit/probe/assets";',
        'if (process.argv[2] === "fail") fail();',
        "console.log(JSON.stringify({",
        '  read: readPrompt("a.v1"),',
        '  rateCard: rateCardPrompt("a.v1"),',
        "  migrations: migrations(),",
        "  where: where(),",
        "  ranAsCli: ranAsCli(),",
        "  entryMain: import.meta.main,",
        "}));",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "assets2.ts"),
      'import { readPrompt } from "@fairsplit/probe/assets";\nconsole.log(readPrompt("a.v1"));\n',
    );
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const probeBuild = (outDir: string, overrides: Partial<UserConfig> = {}) =>
    build({
      ...bundleConfig,
      cwd: dir,
      config: false,
      tsconfig: false,
      sourcemap: false,
      entry: { entry: "entry.ts" },
      outDir,
      ...overrides,
    });
  const node = (args: string[]) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });

  it("Node cannot load it unbundled (this is what plain tsc output would hit)", () => {
    expect(node(["raw.mjs"]).status).not.toBe(0);
  });

  it("without alwaysBundle the workspace import stays external, so the bundle would break too", async () => {
    await probeBuild("out-external", { deps: {} });
    expect(readFileSync(join(dir, "out-external/entry.js"), "utf8")).toMatch(WORKSPACE_IMPORT);
  }, 60_000);

  it("with the fs-tasks config it is inlined and runs under plain node", async () => {
    await probeBuild("out");
    const out = readFileSync(join(dir, "out/entry.js"), "utf8");
    expect(out).not.toMatch(WORKSPACE_IMPORT);
    const r = node(["out/entry.js"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("answer=42");
  }, 60_000);

  it("inlined as Rolldown leaves it, a sibling-file read fails under dist with ENOENT (the bug)", async () => {
    await probeBuild("out-plain", { entry: { assets: "assets.ts" }, plugins: [] });
    const r = node(["out-plain/assets.js"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ENOENT[\s\S]*out-plain[\\/]+prompts[\\/]+a\.v1\.md/);
  }, 60_000);

  it("with the fs-tasks config, dist runs and each inlined module reads its own folder", async () => {
    await probeBuild("out-assets", { entry: { assets: "assets.ts" } });
    const r = node(["out-assets/assets.js"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      read: "read: prompt A",
      rateCard: "rate card: prompt A",
      migrations: ["0000_init.sql", "0001_schema.sql"],
      where: { dirname: join(pkg(), "src"), filename: join(pkg(), "src/where.ts"), main: false },
      ranAsCli: false,
      entryMain: true,
    });
  }, 60_000);

  it("a module placed in a shared chunk (dist/_chunks) resolves the same files", async () => {
    await probeBuild("out-shared", { entry: { assets: "assets.ts", assets2: "assets2.ts" } });
    const chunks = readdirSync(join(dir, "out-shared/_chunks")).filter((f) => f.endsWith(".js"));
    const shared = chunks.map((f) => readFileSync(join(dir, "out-shared/_chunks", f), "utf8")).join("\n");
    expect(shared).toContain('new URL(path, new URL("../", import.meta.url))');
    expect(node(["out-shared/assets2.js"]).stdout.trim()).toBe("read: prompt A");
    expect(JSON.parse(node(["out-shared/assets.js"]).stdout)).toMatchObject({
      read: "read: prompt A",
      rateCard: "rate card: prompt A",
    });
  }, 60_000);

  it("source maps still point into the package's TypeScript, at the right line", async () => {
    await probeBuild("out-maps", { entry: { assets: "assets.ts", assets2: "assets2.ts" }, sourcemap: true });
    const r = node(["--enable-source-maps", "out-maps/assets.js", "fail"]);
    expect(r.status).not.toBe(0);
    const line = WHERE_TS.split("\n").findIndex((l) => l.includes("throw new Error")) + 1;
    expect(r.stderr).toMatch(new RegExp(`probe[\\\\/]src[\\\\/]where\\.ts:${line}:9`));
  }, 60_000);
});
