// The fast-check property tests take 1-2 s each unloaded and run in parallel workers; under CPU load
// they crossed Vitest's 5 s default and the suite went flaky. Every test here gets 30 s.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { testTimeout: 30_000 } });
