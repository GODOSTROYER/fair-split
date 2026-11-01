import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    env: { LOG_LEVEL: "silent", PP_ENV: "sandbox" },
  },
});
