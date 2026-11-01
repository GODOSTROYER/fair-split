// Console-only browser regressions reuse E1's installed Playwright, with a labelled mock Vite server.
// Run from the repo root: corepack pnpm exec playwright test -c apps/console/playwright.config.mjs
export default {
  testDir: "./browser",
  outputDir: "./test-results",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "corepack pnpm --filter @fairsplit/console exec vite build --outDir .codex-scratch/browser-dist && corepack pnpm --filter @fairsplit/console exec vite preview --outDir .codex-scratch/browser-dist --host 127.0.0.1 --port 4197 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4197/judge",
    env: { VITE_PUBLIC_FS_DATA: "mock", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
};
