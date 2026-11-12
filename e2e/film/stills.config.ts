import { defineConfig } from "@playwright/test";

// The stills take (film v7): `corepack pnpm exec playwright test -c e2e/film/stills.config.ts` from the repository
// root. One real judge run on a private stack (free ports, torn down afterwards), shot as still images at device
// scale 2 (film/stills.spec.ts). Opt-in, never part of the regression projects. A session whose Proof does not read
// 6 of 6 is dropped and a fresh one is run (FILM_STILLS_RETRIES, default 2).
export default defineConfig({
  testDir: ".",
  testMatch: "stills.spec.ts",
  outputDir: "../film-out/stills-results",
  globalSetup: "./stills-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: Number(process.env.FILM_STILLS_RETRIES ?? 2),
  timeout: 1_500_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: process.env.FILM_HEADED !== "1",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
    colorScheme: "light",
    actionTimeout: 15_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      // grey-scale text edges (no coloured LCD fringes in a film frame) and one colour profile on every machine
      args: [
        "--disable-lcd-text",
        "--force-color-profile=srgb",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
