// Proves each rule in .dependency-cruiser.cjs fires: a small fixture workspace with planted violations
// (and clean controls) is cruised with the real config, in a child process, from the fixture's root.
// The fixture mirrors this repo's layout: nodeLinker hoisted, zod 3.25.76 hoisted to the root,
// zod 4 nested under the packages that declare catalog:zod.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const depcruiseBin = resolve(repoRoot, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
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

  it("tools are cruised: relative deep import from tools/", () => {
    expect(rulesFor("tools/plant-tool.ts")).toEqual(
      expect.arrayContaining(["no-deep-imports-from-tools", "no-relative-package-imports-from-tools"]),
    );
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

describe("the real tree", () => {
  it("passes deps:check over apps, packages, tools and e2e", () => {
    const result = cruise(repoRoot, ["{apps,packages,tools,e2e}"]);
    expect(result.summary.violations).toEqual([]);
    const sources = result.modules.map((m) => m.source);
    expect(sources).toContain("tools/check-ownership.mjs");
    expect(sources).toContain("packages/test-kit/src/index.ts");
  }, 120_000);
});
