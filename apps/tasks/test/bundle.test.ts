// The built entries are what Render runs. These tests build them with the real tsdown config and
// run them, so a workspace import that would break `node dist/index.js` fails here first.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";
import { runUnderFakeHost } from "../../../tools/lib/fake-workflow-host.js";
import { TASK_NAMES } from "../src/_shims/contracts.js";
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

  it("dist/index.js registers every task under the fake workflow host", async () => {
    const r = await runUnderFakeHost({
      entry: "apps/tasks/dist/index.js",
      cwd: REPO_ROOT,
      env: { PP_ENV: "sandbox" },
      mode: "register",
    });
    expect(r.exitCode).toBe(0);
    expect(r.registered?.map((t) => t.name)).toEqual([...TASK_NAMES, PING_TASK, DB_PING_TASK]);
  });

  it("dist/index.js runs a task through the shared chunks (invoke, wiring)", async () => {
    const r = await runUnderFakeHost({
      entry: "apps/tasks/dist/index.js",
      cwd: REPO_ROOT,
      env: { PP_ENV: "sandbox" },
      mode: "run",
      taskName: "reconcile",
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
describe("bundle config against a TypeScript-source workspace package", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fs-bundle-probe-"));
    const pkg = join(dir, "node_modules/@fairsplit/probe");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@fairsplit/probe", type: "module", exports: { ".": "./src/index.ts" } }),
    );
    writeFileSync(join(pkg, "src/index.ts"), 'export { answer } from "./answer.js";\n');
    writeFileSync(join(pkg, "src/answer.ts"), "export const answer: number = 42;\n");
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
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const probeBuild = (outDir: string, deps: typeof bundleConfig.deps | Record<string, never>) =>
    build({
      ...bundleConfig,
      cwd: dir,
      config: false,
      tsconfig: false,
      sourcemap: false,
      entry: { entry: "entry.ts" },
      outDir,
      deps,
    });

  it("Node cannot load it unbundled (this is what plain tsc output would hit)", () => {
    const r = spawnSync(process.execPath, ["raw.mjs"], { cwd: dir, encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });

  it("without alwaysBundle the workspace import stays external, so the bundle would break too", async () => {
    await probeBuild("out-external", {});
    expect(readFileSync(join(dir, "out-external/entry.js"), "utf8")).toMatch(WORKSPACE_IMPORT);
  }, 60_000);

  it("with the fs-tasks config it is inlined and runs under plain node", async () => {
    await probeBuild("out", bundleConfig.deps);
    const out = readFileSync(join(dir, "out/entry.js"), "utf8");
    expect(out).not.toMatch(WORKSPACE_IMPORT);
    const r = spawnSync(process.execPath, ["out/entry.js"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("answer=42");
  }, 60_000);
});
