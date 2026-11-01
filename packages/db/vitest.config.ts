import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./src/testing/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
