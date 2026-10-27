// One Vitest run for the whole API: the shell, the three slices and WS-PPCORE's webhook route.
// The global setup starts one embedded Postgres per run (packages/db/src/testing) and provides a migrated
// template; `openTestDb()` / `createTestApp({ db: "postgres" })` clone it per test file. Tests that never
// touch a database pay only the cluster start (about half a second after the first initdb).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: "forks",
    env: { LOG_LEVEL: "silent", NODE_ENV: "test", PP_ENV: "sandbox" },
  },
});
