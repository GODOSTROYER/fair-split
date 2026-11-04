// Use the console's declared, catalog-pinned axe-core. No second engine/version or network script.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

const consoleRequire = createRequire(new URL("../../apps/console/package.json", import.meta.url));
const engine = consoleRequire.resolve("axe-core/axe.min.js");
const source = readFileSync(engine, "utf8");

export async function axeScreen(page: Page, screen: string) {
  // Test-runtime evaluation works under the shipped script-src 'self' policy; do not relax that policy.
  for (const frame of page.frames()) {
    // Visible includes entrance/result fades. Scan their actual resting colors, without disabling motion.
    await frame.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished),
      );
    });
    await frame.evaluate(source);
  }
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run(): Promise<{
            violations: {
              id: string;
              impact: string;
              nodes: { target: string[]; failureSummary: string }[];
            }[];
          }>;
        };
      }
    ).axe;
    const { violations } = await axe.run();
    return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  });
  await test.info().attach(`axe-${screen}.json`, {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(violations, `${screen}: no serious or critical axe violations`).toEqual([]);
}
