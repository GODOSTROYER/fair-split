// dependency-cruiser config for Fair Split (decision register section 6, AGENTS.md).
//
// Server layering (an arrow points from a package to what it may import):
//   contracts <- domain <- {seed, db} <- outbox <- {paypal-*, ai} <- {apps/api, apps/tasks}
// UI code (apps/console, apps/mobile and the UI packages) may import only
//   contracts, api-client, tokens, motion, seal, i18n, ui-*.
// Cross-package imports go through a package's declared "exports" (no deep imports), and
// domain stays pure (no node:fs / node:net style IO).
// Every import must be declared in the importing package's own package.json; the packages AGENTS.md
// excludes on purpose are rejected; zod 3.25.76 is imported only inside packages/paypal-*, which in turn
// never import zod 4. packages/ai reaches the money packages only through paypal-toolkit and the read-only
// entry of paypal-payouts (ADR-0004).
//
// Paths are relative to the working directory, so run it from the repository root:
//   corepack pnpm deps:check
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join, posix } = require("node:path");

/** Workspace package dir -> workspace dirs it may import (besides itself). */
const SERVER_ALLOWED = {
  contracts: [],
  domain: ["contracts"],
  seed: ["contracts", "domain"],
  db: ["contracts", "domain"],
  outbox: ["contracts", "domain", "seed", "db"],
  "paypal-core": ["contracts", "domain", "seed", "db", "outbox"],
  "paypal-toolkit": ["contracts", "domain", "seed", "db", "outbox", "paypal-core"],
  "paypal-payouts": ["contracts", "domain", "seed", "db", "outbox", "paypal-core"],
  // ai and paypal-* share a layer (register section 6). The agent's PayPal tools come from paypal-toolkit
  // (agentToolSchemas, tk) and, for get_payout_batch / get_payout_item only, from the read-only entry
  // `@fairsplit/paypal-payouts/read` (rule ai-payouts-read-only, ADR-0004). Never PayoutsService.
  ai: ["contracts", "domain", "seed", "db", "outbox", "paypal-toolkit", "paypal-payouts"],
  // The eval scores the readers in packages/ai; it is tooling, never imported by runtime code.
  eval: ["contracts", "domain", "seed", "ai"],
  // Test helpers: factories read the seed snapshot.
  "test-kit": ["contracts", "domain", "seed"],
};

const UI_PACKAGES = ["contracts", "api-client", "tokens", "motion", "seal", "i18n", "ui-web", "ui-native"];
const UI_PACKAGE_DIRS = ["api-client", "tokens", "motion", "seal", "i18n", "ui-web", "ui-native"];
const SERVER_APPS = ["api", "tasks"];
const UI_APPS = ["console", "mobile"];

/** AGENTS.md "Excluded on purpose" (npm names; a trailing slash means the whole scope). */
const EXCLUDED_PACKAGES = [
  "ai",
  "@ai-sdk/",
  "next",
  "@next/",
  "xstate",
  "@xstate/",
  "nativewind",
  "rive-react-native",
  "@rive-app/",
  "@paypal/mcp",
];

const IO_MODULES = [
  "fs",
  "fs/promises",
  "net",
  "tls",
  "dgram",
  "dns",
  "dns/promises",
  "http",
  "https",
  "http2",
  "child_process",
  "cluster",
  "worker_threads",
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (xs) => xs.map(esc).join("|");
/** A regex source that matches nothing (for rules whose target list is empty). */
const NEVER = "^\\b$^";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function workspaceDirs() {
  const dirs = [];
  for (const root of ["packages", "apps"]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (existsSync(join(root, dir, "package.json"))) dirs.push([root, dir]);
    }
  }
  return dirs;
}

/** Repo-relative files that an "exports" value (or a sub-tree of it) points at. */
function exportTargets(root, dir, value) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(posix.join(root, dir, v));
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(value);
  return out;
}

/** Entry files each workspace package declares in package.json "exports" (repo-relative). */
function exportedEntries() {
  return workspaceDirs().flatMap(([root, dir]) => {
    const json = readJson(join(root, dir, "package.json"));
    return exportTargets(root, dir, json.exports ?? json.main ?? "src/index.ts");
  });
}

/** Files behind `@fairsplit/paypal-payouts/read` (empty until WS-PPMONEY declares that export). */
function payoutsReadEntries() {
  const pj = join("packages", "paypal-payouts", "package.json");
  if (!existsSync(pj)) return [];
  const read = readJson(pj).exports?.["./read"];
  return read ? exportTargets("packages", "paypal-payouts", read) : [];
}

/** Installed copies of zod, split by major version: { 3: [dirs], 4: [dirs] } (repo-relative). */
function zodInstalls() {
  const byMajor = {};
  const candidates = [
    "node_modules/zod",
    ...workspaceDirs().map(([root, dir]) => `${root}/${dir}/node_modules/zod`),
  ];
  for (const dir of candidates) {
    const pj = join(dir, "package.json");
    if (!existsSync(pj)) continue;
    const major = String(readJson(pj).version).split(".")[0];
    byMajor[major] = [...(byMajor[major] ?? []), dir];
  }
  return byMajor;
}

const ENTRY_RE = `^(${alt(exportedEntries())})$`;
const PAYOUTS_READ = payoutsReadEntries();
const ZOD = zodInstalls();
const ZOD3_RE = ZOD["3"] ? `^(${alt(ZOD["3"])})/` : NEVER;
const ZOD4_RE = ZOD["4"] ? `^(${alt(ZOD["4"])})/` : NEVER;
// zod 4 also ships the zod 3 API at "zod/v3"; that counts as zod 3 too.
const ZOD4_V3_RE = ZOD["4"] ? `^(${alt(ZOD["4"])})/v3/` : NEVER;
const EXCLUDED_RE = `(^|/node_modules/|^node_modules/)(${EXCLUDED_PACKAGES.map((p) =>
  p.endsWith("/") ? `${esc(p)}[^/]+` : esc(p),
).join("|")})(/|$)`;

// Known debt that lapses by itself. WS-PPCORE's webhook tests landed in apps/api/src/webhooks before WS-API
// scaffolded apps/api, so there is no apps/api/package.json to declare msw in. While that file is missing,
// those test files may import msw (catalog-pinned, the test-kit's mocking library) and nothing else
// undeclared. Once WS-API adds apps/api/package.json, this matches nothing and msw must be declared there
// (devDependencies, through a deps PR) like any other import.
const PENDING_API_TESTS = existsSync(join("apps", "api", "package.json"))
  ? NEVER
  : "^apps/api/src/webhooks/[^/]+\\.test\\.ts$";

const layerRules = Object.entries(SERVER_ALLOWED).map(([pkg, allowed]) => ({
  name: `layer-${pkg}`,
  comment: `packages/${pkg} may import only: ${allowed.join(", ") || "(no workspace packages)"} (register section 6)`,
  severity: "error",
  from: { path: `^packages/${esc(pkg)}/` },
  to: {
    path: "^(packages|apps)/([^/]+)/",
    pathNot: [`^packages/(${alt([pkg, ...allowed])})/`],
  },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...layerRules,
    {
      name: "ai-payouts-read-only",
      comment:
        "packages/ai may use paypal-payouts only through @fairsplit/paypal-payouts/read (get_payout_batch, " +
        "get_payout_item). create_payout_batch and cancel stay server-only behind PayoutsService (register " +
        "section 8, AI-7, ADR-0004)",
      severity: "error",
      from: { path: "^packages/ai/" },
      to: {
        path: "^packages/paypal-payouts/",
        pathNot: PAYOUTS_READ.length ? `^(${alt(PAYOUTS_READ)})$` : NEVER,
      },
    },
    {
      name: "layer-server-apps",
      comment:
        "apps/api and apps/tasks may import server packages and contracts, never UI packages or other apps",
      severity: "error",
      from: { path: `^apps/(${alt(SERVER_APPS)})/` },
      to: {
        path: "^(packages|apps)/([^/]+)/",
        pathNot: [
          `^packages/(${alt(Object.keys(SERVER_ALLOWED).filter((p) => p !== "test-kit" && p !== "eval"))})/`,
          "^apps/$1/",
        ],
      },
    },
    {
      name: "layer-ui",
      comment:
        "UI code imports only contracts, api-client, tokens, motion, seal, i18n and ui-* (register section 6)",
      severity: "error",
      from: { path: `^(apps/(${alt(UI_APPS)})|packages/(${alt(UI_PACKAGE_DIRS)}))/` },
      to: {
        path: "^(packages|apps)/([^/]+)/",
        pathNot: [`^packages/(${alt(UI_PACKAGES)})/`, "^$1/"],
      },
    },
    {
      name: "no-deep-imports",
      comment: "Import another workspace package only through an entry in its package.json exports",
      severity: "error",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: {
        path: "^(packages|apps)/([^/]+)/",
        pathNot: ["^$1/$2/", ENTRY_RE],
      },
    },
    {
      name: "no-deep-imports-from-tools",
      comment:
        "tools/ and e2e/ import workspace packages only through an entry in their package.json exports",
      severity: "error",
      from: { path: "^(tools|e2e)/" },
      to: { path: "^(packages|apps)/([^/]+)/", pathNot: ENTRY_RE },
    },
    {
      name: "no-relative-cross-package",
      comment: "Cross-package imports use the @fairsplit/<dir> name, never a relative path",
      severity: "error",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: { dependencyTypes: ["local"], path: "^(packages|apps)/([^/]+)/", pathNot: "^$1/$2/" },
    },
    {
      name: "no-relative-package-imports-from-tools",
      comment:
        "tools/ and e2e/ import workspace packages by their @fairsplit/<dir> name, never a relative path",
      severity: "error",
      from: { path: "^(tools|e2e)/" },
      to: { dependencyTypes: ["local"], path: "^(packages|apps)/" },
    },
    {
      name: "no-undeclared-deps",
      comment:
        "Every npm import must be declared in the importing package's own package.json; with nodeLinker " +
        "hoisted an undeclared import silently resolves to whatever is hoisted (for example zod 3)",
      severity: "error",
      from: { pathNot: PENDING_API_TESTS },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-undeclared-deps-until-apps-api-package",
      comment:
        "apps/api has no package.json yet: its webhook tests may import msw undeclared, nothing else. " +
        "Lapses once apps/api/package.json exists",
      severity: "error",
      from: { path: PENDING_API_TESTS },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"], pathNot: "(^|/)node_modules/msw/" },
    },
    {
      name: "no-excluded-packages",
      comment:
        "Excluded on purpose (AGENTS.md): ai / @ai-sdk/*, Next.js, NativeWind, Rive, xstate, @paypal/mcp. " +
        "Some are hoisted as transitive dependencies; they must never be imported",
      severity: "error",
      from: {},
      to: { path: EXCLUDED_RE },
    },
    {
      name: "zod3-only-in-paypal",
      comment: "zod 3.25.76 (catalog:zod3) is used only inside packages/paypal-* (register section 6)",
      severity: "error",
      from: { pathNot: "^packages/paypal-[^/]+/" },
      to: { path: [ZOD3_RE, ZOD4_V3_RE] },
    },
    {
      name: "paypal-uses-zod3",
      comment: "packages/paypal-* use zod 3.25.76 (catalog:zod3), matching @paypal/agent-toolkit 1.11.0",
      severity: "error",
      from: { path: "^packages/paypal-[^/]+/" },
      to: { path: ZOD4_RE },
    },
    {
      name: "domain-is-pure",
      comment: "packages/domain does no IO: no file system, network or process modules",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { dependencyTypes: ["core"], path: `^(node:)?(${alt(IO_MODULES)})$` },
    },
    {
      name: "test-kit-only-in-tests",
      comment: "Runtime code must not import @fairsplit/test-kit; only tests and e2e may",
      severity: "error",
      from: {
        path: "^(packages|apps)/",
        pathNot: ["^packages/test-kit/", "\\.(test|spec)\\.tsx?$", "/(test|tests|__tests__)/"],
      },
      to: { path: "^packages/test-kit/" },
    },
    {
      name: "no-circular",
      comment:
        "No runtime import cycles. A cycle that passes through an `import type` is ignored: with " +
        "verbatimModuleSyntax those imports are erased, so no module waits on another at load time",
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // node_modules must not be excluded: that would drop every npm dependency before the rules above see it.
    // doNotFollow keeps node_modules out of the starting files and stops the cruise at its first file.
    doNotFollow: { path: "(^|/)node_modules/" },
    exclude: { path: "(^|/)(dist|coverage|\\.turbo|\\.expo)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
