import { defineConfig } from "@playwright/test";

// This is an opt-in capture take, never part of the timing or reduced-motion regression projects.
export default defineConfig({
  testDir: "./film",
  testMatch: "film.spec.ts",
  outputDir: "./film-out/test-results",
  globalSetup: "./stack/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: false,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
