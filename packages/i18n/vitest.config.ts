// Every test here is synchronous and CPU-bound (ICU parsing of every catalog message, i18next instances, the
// REVIEW.md render): none uses a timer, a clock or a wait. Unloaded the slowest takes about 40 ms, yet with
// several full-repo test runs sharing the machine some crossed Vitest's 5 s default and the suite went flaky.
// 20 s is a modest budget that load cannot exhaust and a real hang still fails.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { fsModuleCachePath: "./node_modules/.vitest-cache", testTimeout: 20_000 },
});
