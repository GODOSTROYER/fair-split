import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: "./node_modules/.vitest-cache",
    environment: "jsdom",
    // frames.ts first: Motion keeps the requestAnimationFrame it finds when it loads.
    setupFiles: ["./test/frames.ts", "./test/setup.ts"],
  },
});
