// The paypal-core project of vitest.config.ts alone, for mutation testing (tools/stryker/base.mjs).
// Stryker runs the tests from a sandbox copy of this folder, where vitest.config.ts's second project
// (apps/api/src/webhooks, found by a path relative to this file) does not exist.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
