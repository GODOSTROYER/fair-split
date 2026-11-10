// vitest.config.ts for mutation testing (tools/stryker/base.mjs), less photo-hashes.test.ts: Stryker runs
// the tests from a sandbox copy of this folder, from where that test's path to the repo's media/ (relative
// to the test file) does not resolve. It checks served photo bytes, not a figure.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    exclude: [...configDefaults.exclude, "src/photo-hashes.test.ts"],
  },
});
