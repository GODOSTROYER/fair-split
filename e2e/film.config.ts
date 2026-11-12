import { defineConfig } from "@playwright/test";

// This is an opt-in capture take, never part of the timing or reduced-motion regression projects.
// FILM_TAKE=slots runs the recorded slots take (film/slots.spec.ts: every capture slot of the film, cut by
// video/tools/cut-captures.mjs); the default is the paced E-01 take (film/film.spec.ts).
const slots = process.env.FILM_TAKE === "slots";

export default defineConfig({
  testDir: "./film",
  testMatch: slots ? "slots.spec.ts" : "film.spec.ts",
  outputDir: "./film-out/test-results",
  globalSetup: "./stack/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: slots ? 1_200_000 : 300_000,
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
