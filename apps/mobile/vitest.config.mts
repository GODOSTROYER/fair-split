import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic under src/ (no React Native imports in the module under test) and the local web
// server's routing (scripts/), in Node.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
    restoreMocks: true,
  },
});
