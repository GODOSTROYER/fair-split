// dependency-cruiser config for Fair Split (decision register section 6).
//
// Server layering (an arrow points from a package to what it may import):
//   contracts <- domain <- {seed, db} <- outbox <- {paypal-*, ai} <- {apps/api, apps/tasks}
// UI code (apps/console, apps/mobile and the UI packages) may import only
//   contracts, api-client, tokens, motion, seal, i18n, ui-*.
// Cross-package imports go through a package's declared "exports" (no deep imports), and
// domain stays pure (no node:fs / node:net style IO).
//
// Run with: corepack pnpm deps:check
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
  // The audit agent reads invoices and payout batches through the money packages' read tools.
  ai: ["contracts", "domain", "seed", "db", "outbox", "paypal-core", "paypal-toolkit", "paypal-payouts"],
  // The eval scores the readers in packages/ai; it is tooling, never imported by runtime code.
  eval: ["contracts", "domain", "seed", "ai"],
  // Test helpers: factories read the seed snapshot.
  "test-kit": ["contracts", "domain", "seed"],
};

const UI_PACKAGES = ["contracts", "api-client", "tokens", "motion", "seal", "i18n", "ui-web", "ui-native"];
const UI_PACKAGE_DIRS = ["api-client", "tokens", "motion", "seal", "i18n", "ui-web", "ui-native"];
const SERVER_APPS = ["api", "tasks"];
const UI_APPS = ["console", "mobile"];

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

/** Entry files each workspace package declares in package.json "exports" (repo-relative). */
function exportedEntries() {
  const entries = [];
  for (const root of ["packages", "apps"]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const pj = join(root, dir, "package.json");
      if (!existsSync(pj)) continue;
      const json = JSON.parse(readFileSync(pj, "utf8"));
      const walk = (v) => {
        if (typeof v === "string") entries.push(posix.join(root, dir, v));
        else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
      };
      walk(json.exports ?? json.main ?? "src/index.ts");
    }
  }
  return entries;
}

const ENTRY_RE = `^(${alt(exportedEntries())})$`;

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
      name: "no-relative-cross-package",
      comment: "Cross-package imports use the @fairsplit/<dir> name, never a relative path",
      severity: "error",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: { dependencyTypes: ["local"], path: "^(packages|apps)/([^/]+)/", pathNot: "^$1/$2/" },
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
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|coverage|\\.turbo|\\.expo)/" },
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
