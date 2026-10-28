// Proves each rule in .dependency-cruiser.cjs fires: a small fixture workspace with planted violations
// (and clean controls) is cruised with the real config, in a child process, from the fixture's root.
// The fixture mirrors this repo's layout: nodeLinker hoisted, zod 3.25.76 hoisted to the root,
// zod 4 nested under the packages that declare catalog:zod.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const depcruiseBin = resolve(repoRoot, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
const biomeBin = resolve(repoRoot, "node_modules/@biomejs/biome/bin/biome");
const config = resolve(repoRoot, ".dependency-cruiser.cjs");

/** Runs dependency-cruiser over `targets` with cwd `root`; returns the JSON result. */
function cruise(root, targets) {
  const r = spawnSync(
    process.execPath,
    [depcruiseBin, "--config", config, "--output-type", "json", ...targets],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!r.stdout) throw new Error(`depcruise produced no output: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const pkgJson = (name, extra = {}) =>
  JSON.stringify({ name, version: "0.0.0", private: true, type: "module", ...extra }, null, 2);

/** Two runtime cycles whose type edge is written inline, plus their `import type` / `export type` forms. */
const INLINE_TYPE_CYCLES = {
  "inline-import-a.ts":
    'import { type B } from "./inline-import-b.js";\nexport type A = { b?: B };\nexport const a = 1;\n',
  "inline-import-b.ts":
    'import { a } from "./inline-import-a.js";\nexport type B = { a: typeof a };\nexport const b = a;\n',
  "inline-export-a.ts": 'export { type B } from "./inline-export-b.js";\nexport const a = 1;\n',
  "inline-export-b.ts":
    'import { a } from "./inline-export-a.js";\nexport type B = { a: typeof a };\nexport const b = a;\n',
};
const ERASED_TYPE_EDGES = {
  "erased-import-a.ts":
    'import type { B } from "./erased-import-b.js";\nexport type A = { b?: B };\nexport const a = 1;\n',
  "erased-export-a.ts": 'export type { B } from "./erased-import-b.js";\nexport const c = 1;\n',
  "erased-import-b.ts":
    'import { a } from "./erased-import-a.js";\nexport type B = { a: typeof a };\nexport const b = a;\n',
};

let fx;
let violations;

function put(rel, text) {
  const file = join(fx, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function npmPackage(dir, name, version, files = { "index.js": "export {};\n" }) {
  put(`${dir}/package.json`, JSON.stringify({ name, version, main: "index.js" }));
  for (const [f, text] of Object.entries(files)) put(`${dir}/${f}`, text);
}

function workspacePackage(dir, deps = {}, exportsField = { ".": "./src/index.ts" }) {
  put(
    `packages/${dir}/package.json`,
    pkgJson(`@fairsplit/${dir}`, { exports: exportsField, dependencies: deps }),
  );
  mkdirSync(join(fx, "node_modules/@fairsplit"), { recursive: true });
  symlinkSync(join(fx, "packages", dir), join(fx, "node_modules/@fairsplit", dir), "junction");
}

const hits = (rule, fromFile) =>
  violations.filter((v) => v.rule.name === rule && (fromFile === undefined || v.from === fromFile));
const rulesFor = (fromFile) => [
  ...new Set(violations.filter((v) => v.from === fromFile).map((v) => v.rule.name)),
];

beforeAll(() => {
  // Inside this worktree (gitignored node_modules), never outside it.
  const base = resolve(repoRoot, "packages/test-kit/node_modules/.cache/depcruise-fixtures");
  mkdirSync(base, { recursive: true });
  fx = mkdtempSync(join(base, "fx-"));
  copyFileSync(resolve(repoRoot, "tsconfig.base.json"), join(fx, "tsconfig.base.json"));
  put("package.json", pkgJson("fixture-root"));

  // Hoisted installs.
  npmPackage("node_modules/zod", "zod", "3.25.76");
  npmPackage("node_modules/ai", "ai", "4.3.19");
  npmPackage("node_modules/@ai-sdk/provider", "@ai-sdk/provider", "1.1.3");
  npmPackage("node_modules/canonicalize", "canonicalize", "5.1.0");

  // contracts: declares zod 4 (nested), plus planted imports of excluded packages and zod/v3.
  workspacePackage("contracts", { zod: "catalog:", ai: "4.3.19", "@ai-sdk/provider": "1.1.3" });
  npmPackage("packages/contracts/node_modules/zod", "zod", "4.6.7", {
    "index.js": "export {};\n",
    "v3/index.js": "export {};\n",
  });
  put("packages/contracts/src/index.ts", 'import { z } from "zod";\nexport const Id = z;\n');
  put("packages/contracts/src/plant-ai.ts", 'import "ai";\nimport "@ai-sdk/provider";\nexport {};\n');
  put("packages/contracts/src/plant-zod-v3.ts", 'import "zod/v3";\nexport {};\n');

  // domain: declares canonicalize only; the planted zod import is undeclared and hits hoisted zod 3.
  workspacePackage("domain", { "@fairsplit/contracts": "workspace:*", canonicalize: "catalog:" });
  put(
    "packages/domain/src/index.ts",
    'import canonicalize from "canonicalize";\nexport const c = canonicalize;\n',
  );
  put("packages/domain/src/plant-zod.ts", 'import { z } from "zod";\nexport const s = z;\n');

  // db: a server package the UI must not reach.
  workspacePackage("db", { "@fairsplit/domain": "workspace:*" });
  put("packages/db/src/index.ts", "export const db = 1;\n");

  // paypal-core: zod 3 through the hoisted copy (clean). paypal-toolkit: a nested zod 4 (planted).
  workspacePackage("paypal-core", { zod: "catalog:zod3" });
  put("packages/paypal-core/src/index.ts", 'import { z } from "zod";\nexport const s = z;\n');
  workspacePackage("paypal-toolkit", { zod: "catalog:" });
  npmPackage("packages/paypal-toolkit/node_modules/zod", "zod", "4.6.7");
  put("packages/paypal-toolkit/src/index.ts", 'import { z } from "zod";\nexport const s = z;\n');

  // paypal-payouts with a read-only entry; ai imports both entries.
  workspacePackage("paypal-payouts", {}, { ".": "./src/index.ts", "./read": "./src/read.ts" });
  put("packages/paypal-payouts/src/index.ts", "export const executeApproved = 1;\n");
  put("packages/paypal-payouts/src/read.ts", "export const getPayoutBatch = 1;\n");
  workspacePackage("ai", { "@fairsplit/paypal-payouts": "workspace:*" });
  put(
    "packages/ai/src/index.ts",
    'import { getPayoutBatch } from "@fairsplit/paypal-payouts/read";\nexport { getPayoutBatch };\n',
  );
  put(
    "packages/ai/src/plant-payouts.ts",
    'import { executeApproved } from "@fairsplit/paypal-payouts";\nexport { executeApproved };\n',
  );

  // motion: a package-root file (register IC-10 puts packages/motion/moments.ts there) importing db.
  workspacePackage("motion", {});
  put("packages/motion/src/index.ts", "export const m = 1;\n");
  put("packages/motion/moments.ts", 'import { db } from "../db/src/index.js";\nexport const x = db;\n');

  // tools: a script that deep-imports a package by relative path.
  put("packages/domain/src/money.ts", "export const cents = 1;\n");
  put(
    "tools/plant-tool.ts",
    'import { cents } from "../packages/domain/src/money.js";\nexport const y = cents;\n',
  );

  // A tool may import its own workstream's package source (docs/ownership.md, the real rules): WS-OPS owns
  // tools/** (except other rows' tools) and apps/tasks; WS-PPSIM owns tools/paypal-sim.ts and packages/paypal-sim;
  // WS-MEDIA owns tools/tts.ts; WS-QA owns e2e/**.
  put("docs/ownership.md", readFileSync(resolve(repoRoot, "docs/ownership.md"), "utf8"));
  put("apps/tasks/package.json", pkgJson("@fairsplit/tasks", { exports: { ".": "./src/index.ts" } }));
  put("apps/tasks/src/index.ts", "export const tasks = 1;\n");
  put("apps/tasks/src/env.ts", "export const env = 1;\n");
  workspacePackage("paypal-sim", {});
  put("packages/paypal-sim/src/index.ts", "export const sim = 1;\n");
  put("packages/paypal-sim/src/bin/start.ts", "export const start = 1;\n");
  const fromTasks = (depth) =>
    `import { env } from "${"../".repeat(depth)}apps/tasks/src/env.js";\nexport { env };\n`;
  const fromSim = 'import { start } from "../packages/paypal-sim/src/bin/start.js";\nexport { start };\n';
  put("tools/ops-health.ts", fromTasks(1)); // WS-OPS -> apps/tasks: same workstream
  put("tools/lib/ops-lib.ts", fromTasks(2)); // WS-OPS -> apps/tasks: same workstream
  put("tools/paypal-sim.ts", fromSim); // WS-PPSIM -> packages/paypal-sim: same workstream
  put("tools/tts.ts", fromTasks(1)); // WS-MEDIA -> apps/tasks (WS-OPS)
  put("tools/ops-sim.ts", fromSim); // WS-OPS -> packages/paypal-sim (WS-PPSIM)
  put("e2e/plant-e2e.ts", fromTasks(1)); // WS-QA -> apps/tasks (WS-OPS)

  // apps/api before WS-API scaffolds it (no package.json): its webhook tests may import msw and fast-check
  // undeclared.
  npmPackage("node_modules/msw", "msw", "3.0.3");
  npmPackage("node_modules/fast-check", "fast-check", "4.10.2");
  put("apps/api/src/webhooks/plant-msw.test.ts", 'import "msw";\nexport {};\n');
  put("apps/api/src/webhooks/plant-fc.test.ts", 'import fc from "fast-check";\nexport const f = fc;\n');
  put("apps/api/src/webhooks/plant-fc-runtime.ts", 'import "fast-check";\nexport {};\n');
  put("apps/api/src/webhooks/plant-other.test.ts", 'import "canonicalize";\nexport {};\n');
  put("apps/api/src/webhooks/plant-runtime.ts", 'import "msw";\nexport {};\n');
  // ...and runtime code must not reach msw (or any test code) through a test file's re-export.
  put("apps/api/src/webhooks/plant-reexport.test.ts", 'export * from "msw";\n');
  put("apps/api/src/webhooks/plant-route.ts", 'export * from "./plant-reexport.test.js";\n');
  // Clean controls: a test importing a test helper, and a developer CLI building from test fakes.
  put("apps/api/src/test/fakes.ts", "export const fake = 1;\n");
  put(
    "apps/api/src/webhooks/plant-helper.test.ts",
    'import { fake } from "../test/fakes.js";\nexport { fake };\n',
  );
  put("apps/api/src/print.cli.ts", 'import { fake } from "./test/fakes.js";\nexport { fake };\n');
  put("apps/api/src/plant-uses-cli.ts", 'import { fake } from "./print.cli.js";\nexport { fake };\n');

  // api-client (ADR-0009): it may import domain and seed, never a server package like db. fs-api may import
  // its HTTP table; only fs-api's tests and smoke CLI may import the typed client itself.
  workspacePackage(
    "api-client",
    { "@fairsplit/domain": "workspace:*", "@fairsplit/db": "workspace:*" },
    { ".": "./src/index.ts", "./http": "./src/http.ts" },
  );
  put("packages/api-client/src/http.ts", "export const API_COMMANDS = 1;\n");
  put(
    "packages/api-client/src/index.ts",
    'import { c } from "@fairsplit/domain";\nexport { API_COMMANDS } from "./http.js";\nexport const f = c;\n',
  );
  put("packages/api-client/src/plant-db.ts", 'import { db } from "@fairsplit/db";\nexport const x = db;\n');
  const clientImport = (entry) =>
    `import { API_COMMANDS } from "@fairsplit/api-client${entry}";\nexport { API_COMMANDS };\n`;
  put("apps/api/src/plant-client.ts", clientImport(""));
  put("apps/api/src/lib/plant-http.ts", clientImport("/http"));
  put("apps/api/src/plant-client.test.ts", clientImport(""));
  put("apps/api/src/test/plant-harness.ts", clientImport(""));
  put("apps/api/src/smoke/plant-checks.ts", clientImport(""));
  put(
    "apps/api/src/smoke/plant-db.ts",
    'import { db } from "@fairsplit/db";\nimport "@fairsplit/motion";\nexport { db };\n',
  );
  // Tool state under .cache (apps/api keeps its embedded test Postgres there) is never cruised.
  put("apps/api/.cache/pg/plant-cache.ts", 'import "@fairsplit/motion";\nexport const x = 1;\n');

  // Cycles: a runtime one (planted) and one that passes through an `import type` (clean).
  put("packages/db/src/cycle-a.ts", 'import { b } from "./cycle-b.js";\nexport const a = () => b;\n');
  put("packages/db/src/cycle-b.ts", 'import { a } from "./cycle-a.js";\nexport const b = () => a;\n');
  put(
    "packages/db/src/type-a.ts",
    'import type { B } from "./type-b.js";\nexport type A = { b?: B };\nexport const a = 1;\n',
  );
  put("packages/db/src/type-b.ts", 'import { a } from "./type-a.js";\nexport type B = { a: typeof a };\n');
  // Runtime cycles that dependency-cruiser calls type-only: TypeScript keeps `import { type B }` as
  // `import {} from` and `export { type B } from` as `export {} from`. Biome refuses both (see below).
  for (const [name, text] of Object.entries(INLINE_TYPE_CYCLES)) put(`packages/db/src/${name}`, text);

  violations = cruise(fx, ["{apps,packages,tools,e2e}"]).summary.violations;
}, 120_000);

afterAll(() => {
  if (process.env.KEEP_DEPCRUISE_FIXTURE) return; // keep it to debug a rule by hand
  if (fx) rmSync(fx, { recursive: true, force: true });
});

describe("dependency-cruiser rules fire on planted violations", () => {
  it("no-undeclared-deps: domain importing zod without declaring it", () => {
    expect(hits("no-undeclared-deps", "packages/domain/src/plant-zod.ts")).toHaveLength(1);
  });

  it("zod3-only-in-paypal: the undeclared import resolved to hoisted zod 3, and zod/v3 from zod 4", () => {
    expect(hits("zod3-only-in-paypal", "packages/domain/src/plant-zod.ts")).toHaveLength(1);
    expect(hits("zod3-only-in-paypal", "packages/contracts/src/plant-zod-v3.ts")).toHaveLength(1);
  });

  it("paypal-uses-zod3: a paypal-* package resolving zod 4", () => {
    expect(hits("paypal-uses-zod3", "packages/paypal-toolkit/src/index.ts")).toHaveLength(1);
  });

  it("no-excluded-packages: ai and @ai-sdk/* even when declared", () => {
    const tos = hits("no-excluded-packages", "packages/contracts/src/plant-ai.ts").map((v) => v.to);
    expect(tos).toHaveLength(2);
    expect(tos.join(" ")).toMatch(/node_modules\/ai\//);
    expect(tos.join(" ")).toMatch(/node_modules\/@ai-sdk\/provider\//);
  });

  it("ai-payouts-read-only: packages/ai importing the payouts main entry", () => {
    expect(hits("ai-payouts-read-only", "packages/ai/src/plant-payouts.ts")).toHaveLength(1);
  });

  it("layer-ui: a package-root file in packages/motion importing a server package", () => {
    expect(hits("layer-ui", "packages/motion/moments.ts")).toHaveLength(1);
  });

  it("layer-api-client: api-client may reach domain (and seed), never a server package like db", () => {
    expect(hits("layer-api-client", "packages/api-client/src/plant-db.ts")).toHaveLength(1);
    expect(hits("layer-api-client", "packages/api-client/src/index.ts")).toEqual([]);
    expect(hits("layer-ui", "packages/api-client/src/index.ts")).toEqual([]);
  });

  it("layer-server-apps: fs-api runtime may import api-client's HTTP table only; tests and smoke use the client", () => {
    expect(hits("layer-server-apps", "apps/api/src/plant-client.ts")).toHaveLength(1);
    for (const f of [
      "apps/api/src/lib/plant-http.ts",
      "apps/api/src/plant-client.test.ts",
      "apps/api/src/test/plant-harness.ts",
      "apps/api/src/smoke/plant-checks.ts",
    ]) {
      expect(hits("layer-server-apps", f), f).toEqual([]);
      expect(hits("layer-server-apps-tests", f), f).toEqual([]);
    }
    // The smoke CLI's allowance is the typed client only: a UI package still fails.
    expect(hits("layer-server-apps-tests", "apps/api/src/smoke/plant-db.ts")).toHaveLength(1);
  });

  it("tool state is not cruised: a UI import under apps/api/.cache raises nothing", () => {
    expect(rulesFor("apps/api/.cache/pg/plant-cache.ts")).toEqual([]);
    expect(violations.filter((v) => v.from.includes("/.cache/"))).toEqual([]);
  });

  it("tools are cruised: relative deep import from tools/", () => {
    expect(rulesFor("tools/plant-tool.ts")).toEqual(
      expect.arrayContaining(["no-deep-imports-from-tools", "no-relative-package-imports-from-tools"]),
    );
  });

  it("no-circular: a runtime cycle fires; a cycle through an `import type` does not", () => {
    expect(hits("no-circular", "packages/db/src/cycle-a.ts").length).toBeGreaterThan(0);
    expect(rulesFor("packages/db/src/type-a.ts")).toEqual([]);
    expect(rulesFor("packages/db/src/type-b.ts")).toEqual([]);
  });

  it("no-circular cannot see a cycle whose type edge is written inline, so Biome refuses that form", () => {
    // dependency-cruiser labels `import { type B }` and `export { type B } from` type-only, although TypeScript
    // keeps both as runtime imports. The Biome test below proves those forms cannot reach the tree.
    for (const f of Object.keys(INLINE_TYPE_CYCLES)) expect(rulesFor(`packages/db/src/${f}`), f).toEqual([]);
  });

  it("apps/api without a package.json: its webhook tests may import msw and fast-check undeclared, nothing else", () => {
    expect(rulesFor("apps/api/src/webhooks/plant-msw.test.ts")).toEqual([]);
    expect(rulesFor("apps/api/src/webhooks/plant-fc.test.ts")).toEqual([]);
    const other = "apps/api/src/webhooks/plant-other.test.ts";
    expect(hits("no-undeclared-deps-until-apps-api-package", other)).toHaveLength(1);
    expect(hits("no-undeclared-deps", "apps/api/src/webhooks/plant-runtime.ts")).toHaveLength(1);
    expect(hits("no-undeclared-deps", "apps/api/src/webhooks/plant-fc-runtime.ts")).toHaveLength(1);
  });

  it("a tool may import its own workstream's package source by path; any other tool goes through exports", () => {
    // Same workstream per docs/ownership.md: WS-OPS's tools and apps/tasks, WS-PPSIM's tool and its package.
    for (const f of ["tools/ops-health.ts", "tools/lib/ops-lib.ts", "tools/paypal-sim.ts"]) {
      expect(rulesFor(f), f).toEqual([]);
    }
    const both = ["no-deep-imports-from-tools", "no-relative-package-imports-from-tools"];
    for (const f of ["tools/tts.ts", "tools/ops-sim.ts", "e2e/plant-e2e.ts", "tools/plant-tool.ts"]) {
      expect(rulesFor(f).sort(), f).toEqual(both);
    }
  });

  it("no-runtime-imports-of-tests: runtime code reaching msw through a test's re-export, or importing a CLI", () => {
    expect(hits("no-runtime-imports-of-tests", "apps/api/src/webhooks/plant-route.ts")).toHaveLength(1);
    expect(hits("no-runtime-imports-of-tests", "apps/api/src/plant-uses-cli.ts")).toHaveLength(1);
    // Clean: the re-exporting test itself (the msw allowance), a test helper import, a CLI using test fakes.
    for (const f of [
      "apps/api/src/webhooks/plant-reexport.test.ts",
      "apps/api/src/webhooks/plant-helper.test.ts",
      "apps/api/src/test/fakes.ts",
      "apps/api/src/print.cli.ts",
    ]) {
      expect(rulesFor(f), f).toEqual([]);
    }
  });

  it("clean controls stay clean", () => {
    for (const f of [
      "packages/contracts/src/index.ts",
      "packages/domain/src/index.ts",
      "packages/domain/src/money.ts",
      "packages/paypal-core/src/index.ts",
      "packages/ai/src/index.ts",
      "packages/motion/src/index.ts",
      "packages/db/src/index.ts",
    ]) {
      expect(rulesFor(f), f).toEqual([]);
    }
  });
});

describe("the apps/api msw allowance", () => {
  // Runs after the planted-violation checks above: it adds apps/api/package.json to the shared fixture.
  it("lapses once apps/api/package.json exists: msw and fast-check must then be declared there", () => {
    put("apps/api/package.json", pkgJson("@fairsplit/api"));
    const after = cruise(fx, ["apps"]).summary.violations;
    for (const f of ["plant-msw.test.ts", "plant-fc.test.ts"]) {
      const found = after.filter((v) => v.from === `apps/api/src/webhooks/${f}`);
      expect(
        found.map((v) => v.rule.name),
        f,
      ).toEqual(["no-undeclared-deps"]);
    }
  }, 120_000);
});

describe("the same-workstream tools exemption", () => {
  // Runs after the checks above: it removes the fixture's docs/ownership.md.
  it("exempts no tool when docs/ownership.md cannot be read", () => {
    rmSync(join(fx, "docs/ownership.md"));
    const after = cruise(fx, ["tools"]).summary.violations;
    for (const f of ["tools/ops-health.ts", "tools/lib/ops-lib.ts", "tools/paypal-sim.ts"]) {
      const rules = [...new Set(after.filter((v) => v.from === f).map((v) => v.rule.name))].sort();
      expect(rules, f).toEqual(["no-deep-imports-from-tools", "no-relative-package-imports-from-tools"]);
    }
  }, 120_000);
});

describe("Biome keeps every edge that dependency-cruiser calls type-only erased", () => {
  it("errors on `import { type X }` and `export { type X } from`, and accepts `import type` / `export type`", () => {
    // Outside the repo: biome.json ignores node_modules, where the depcruise fixture lives.
    const dir = mkdtempSync(join(tmpdir(), "fs-biome-type-edges-"));
    try {
      copyFileSync(resolve(repoRoot, "biome.json"), join(dir, "biome.json"));
      for (const [name, text] of Object.entries({ ...INLINE_TYPE_CYCLES, ...ERASED_TYPE_EDGES })) {
        writeFileSync(join(dir, name), text);
      }
      const r = spawnSync(
        process.execPath,
        [biomeBin, "lint", "--reporter=json", "--colors=off", "--config-path", dir, dir],
        { cwd: dir, encoding: "utf8" },
      );
      const report = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
      const found = report.diagnostics.map((d) => [d.category, d.severity, basename(d.location.path)]).sort();
      expect(found).toEqual([
        ["lint/style/useExportType", "error", "inline-export-a.ts"],
        ["lint/style/useImportType", "error", "inline-import-a.ts"],
      ]);
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the real tree", () => {
  // The whole-tree cruise is CPU-bound: about 90 s alone on a busy Windows machine, and over 300 s beside test-kit's
  // other files while other workstreams build on the same machine. It always ends, and a timeout here says nothing
  // about the rules, so the budget is ten minutes.
  it("passes deps:check over apps, packages, tools and e2e", () => {
    const result = cruise(repoRoot, ["{apps,packages,tools,e2e}"]);
    expect(result.summary.violations).toEqual([]);
    const sources = result.modules.map((m) => m.source);
    expect(sources).toContain("tools/check-ownership.mjs");
    expect(sources).toContain("packages/test-kit/src/index.ts");
  }, 600_000);
});
