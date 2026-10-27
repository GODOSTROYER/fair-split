// Bundles the three entries Render and CI run (dist/index.js, dist/cron.js, dist/inline.js).
//
// Every @fairsplit/* workspace package exports TypeScript source (`exports` → ./src/index.ts, with
// `.js` relative specifiers) and has no build step, so plain `tsc` output would either fail
// (TS6059, file outside rootDir) or make Node load .ts files at runtime (refused under
// node_modules, ERR_MODULE_NOT_FOUND for the `.js` specifiers otherwise). The bundle therefore
// inlines every workspace package and leaves real npm dependencies external; they are installed
// on Render by `pnpm install --frozen-lockfile` in the build command.
//
// Inlined modules keep their own `import.meta` (build/inline-import-meta.ts), so a package that reads
// files next to its source (packages/ai's prompts, packages/db's migrations) finds them in the
// checkout, as it does unbundled. dist therefore runs where it was built, which is how Render runs it.
//
// tsdown loads this file with Node's own TypeScript support, which resolves `.ts` specifiers only.
import { defineConfig, type UserConfig } from "tsdown";
import { inlinedImportMeta } from "./build/inline-import-meta.ts";

/** Workspace packages that must be inlined into the bundle. */
export const WORKSPACE_PACKAGES = /^@fairsplit\//;

export const ENTRIES = {
  index: "src/index.ts",
  cron: "src/cron.ts",
  inline: "src/inline.ts",
} as const;

export const bundleConfig = {
  entry: { ...ENTRIES },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node24",
  // `.js`, not `.mjs`: render.yaml start commands name dist/<entry>.js and package.json is ESM.
  fixedExtension: false,
  hash: false,
  // Shared code goes to dist/_chunks so it can never shadow an entry name.
  outputOptions: { chunkFileNames: "_chunks/[name].js" },
  clean: true,
  dts: false,
  sourcemap: true,
  deps: { alwaysBundle: [WORKSPACE_PACKAGES] },
  plugins: [inlinedImportMeta()],
  logLevel: "warn",
} satisfies UserConfig;

export default defineConfig(bundleConfig);
