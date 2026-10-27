import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Refuses listen() on a fixed port in every test: servers bind port 0 and read the bound port back.
    setupFiles: ["test/setup.ts"],
    pool: "forks",
    // These limits only catch hangs. No assertion depends on how fast the machine is (timing-sensitive tests
    // run on fake timers, see fakeTime() in test/helpers.ts), but on a loaded machine one test took up to 10 s
    // with four to six copies of this suite running at once, so 30 s left too little room when every worktree
    // tests at the same time. test/helpers.ts keeps BEYOND_TEST_TIMEOUT_MS above these.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
