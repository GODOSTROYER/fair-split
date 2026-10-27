// Bundles dist/index.js, the file render.yaml starts (`node apps/api/dist/index.js`).
//
// Every @fairsplit/* package exports TypeScript source with `.js` specifiers and has no build step, so the
// bundle inlines them and leaves real npm dependencies external (installed on Render by
// `pnpm install --frozen-lockfile`). Same shape as apps/tasks/tsdown.config.ts.
//
// zod is bundled too: the paypal-* packages pin zod 3 (catalog:zod3) and everything else zod 4. Inlined, each
// import resolves from its importer (packages/paypal-* → zod 3.25.76, the API and contracts → zod 4.6.7), as
// in development and tests; left external, every bundled `import "zod"` would load apps/api's zod 4.
import { defineConfig, type UserConfig } from "tsdown";

export const bundleConfig = {
  entry: { index: "src/index.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node24",
  fixedExtension: false,
  hash: false,
  outputOptions: { chunkFileNames: "_chunks/[name].js" },
  clean: true,
  dts: false,
  sourcemap: true,
  deps: { alwaysBundle: [/^@fairsplit\//, /^zod(?:\/|$)/] },
  logLevel: "warn",
} satisfies UserConfig;

export default defineConfig(bundleConfig);
