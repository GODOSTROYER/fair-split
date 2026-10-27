import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Refuses listen() on a fixed port in every test: servers bind port 0 and read the bound port back.
    setupFiles: ["test/setup.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
