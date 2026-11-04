// Explicitly synthetic DOM hooks test the harness itself, never a payroll or PayPal result.
import { expect, test } from "../../lib/fixtures.js";
import { observeMoments } from "../../lib/moments.js";

test("moment observer records real DOM commits in the page and a same-origin frame", async ({
  page,
  context,
}) => {
  const observations = await observeMoments(context);
  await page.route("**/__e2e-observer*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<!doctype html><title>Synthetic observer fixture</title><div data-moment="MM-S" data-moment-phase="waiting">Synthetic observer fixture</div>' +
        (route.request().url().endsWith("-child")
          ? ""
          : '<iframe name="fixture" src="/__e2e-observer-child"></iframe>'),
    }),
  );
  await page.goto("/__e2e-observer");
  await expect(page.frameLocator("iframe").locator("[data-moment]")).toBeVisible();
  await page.locator("[data-moment]").evaluate((root) => root.setAttribute("data-moment-phase", "funded"));
  await page
    .frameLocator("iframe")
    .locator("[data-moment]")
    .evaluate((root) => root.setAttribute("data-moment-phase", "funded"));
  await expect
    .poll(() =>
      observations.landings
        .filter((entry) => entry.phase === "funded")
        .map((entry) => entry.frame)
        .sort(),
    )
    .toEqual(["", "fixture"]);
  observations.clear();
  for (const frame of page.frames()) {
    await frame.locator("[data-moment]").evaluate((root) => {
      // Three actual attribute writes in one task must survive a batched MutationObserver delivery.
      for (const phase of ["waiting", "arc", "funded"]) root.setAttribute("data-moment-phase", phase);
    });
  }
  await expect
    .poll(() => observations.landings.filter((entry) => entry.phase === "arc").length, { timeout: 5_000 })
    .toBe(2);
  for (const frame of ["", "fixture"]) observations.ordered("MM-S", ["waiting", "arc", "funded"], frame);
});
