// The specs' `test`: baseURL is the stack global-setup started (or E2E_BASE_URL), read when the worker runs, since the
// config is evaluated before the stack exists.
import { test as base } from "@playwright/test";

export function stackOrigin(): string {
  const origin = process.env.E2E_BASE_URL;
  if (!origin)
    throw new Error("E2E_BASE_URL is not set: run the specs through playwright.config.ts (global setup)");
  return origin.replace(/\/+$/, "");
}

export const test = base.extend<{ origin: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern
  baseURL: async ({}, use) => {
    await use(stackOrigin());
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern
  origin: async ({}, use) => {
    await use(stackOrigin());
  },
});

export { expect } from "@playwright/test";
