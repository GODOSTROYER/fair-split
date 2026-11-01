import { expect, test } from "../../../e2e/lib/fixtures.ts";

test.use({ baseURL: "http://127.0.0.1:4197", viewport: { width: 1680, height: 1050 } });

test("invoice action and amount fit beside the photos at 1680 px", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/judge");
  await expect(page).toHaveTitle(/Fair Split/);
  await expect(page.getByTestId("W-JG-01.markPaid.face")).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const overlap = await page.locator(".fsc-fund__invoice").evaluate((invoice) => {
    const bounds = invoice.getBoundingClientRect();
    const photos = document.querySelector(".fsc-fund__desk")?.getBoundingClientRect();
    const overflow = [...invoice.querySelectorAll("button, .fsc-fund__total")].some((item) => {
      const r = item.getBoundingClientRect();
      return r.left < bounds.left - 1 || r.right > bounds.right + 1;
    });
    return {
      overflow,
      overlapsPhotos:
        !!photos &&
        bounds.right > photos.left + 1 &&
        bounds.top < photos.bottom &&
        bounds.bottom > photos.top,
    };
  });
  expect(overlap).toEqual({ overflow: false, overlapsPhotos: false });
  expect(errors).toEqual([]);
  await page.screenshot({ path: ".codex-scratch/c5-invoice-1680.png" });
});
