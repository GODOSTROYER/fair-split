import { defineConfig } from "vitest/config";
import { exhibitDefines } from "./scripts/exhibit-data.js";

// Console tests: jsdom by default (pure logic files opt into `// @vitest-environment node`), WS-DS's setup,
// then the console's own (src/test/setup.ts). Tests answer from a mock world over the seed; nothing reaches
// the network (msw fails unhandled requests), and no live API is ever called.
export default defineConfig({
  define: { __FS_DATA__: JSON.stringify("mock"), ...exhibitDefines() },
  resolve: { dedupe: ["zod"] },
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    environment: "jsdom",
    setupFiles: ["./test/setup.ts", "./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
  },
});
