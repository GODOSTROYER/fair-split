import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
