// The e2e suite (E1): `corepack pnpm e2e` from the repository root. Global setup starts one private stack
// (stack/stack.ts) and its returned teardown stops it. Chromium only, one worker (the specs share one fs-api, whose
// judge lane is single-flight), no retries locally.
//
//   api       specs/api: fs-api driven over HTTP the way the console and the Chair's frame call it
//   chromium  specs/browser: the console fs-api serves, in Chromium (Playwright's build, never downloaded here)
import { defineConfig, devices } from "@playwright/test";

const CI = process.env.CI === "true";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  globalSetup: "./stack/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  // on CI the list goes to the log and failures become annotations on the run (nothing is uploaded)
  reporter: CI ? [["list"], ["github"]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "api", testDir: "./specs/api" },
    { name: "chromium", testDir: "./specs/browser", use: { ...devices["Desktop Chrome"] } },
    {
      name: "reduced-motion",
      testDir: "./specs/browser",
      use: { ...devices["Desktop Chrome"], reducedMotion: "reduce" },
    },
  ],
});
