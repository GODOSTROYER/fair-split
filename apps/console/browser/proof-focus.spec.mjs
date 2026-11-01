// Use E1's fixtures so this console-only regression needs no new dependency or real service.
import { expect, test } from "../../../e2e/lib/fixtures.ts";

test.use({ baseURL: "http://127.0.0.1:4197" });

test("Proof chip, wheel, paragraph click, Tab continues after the paragraph", async ({ page }) => {
  await page.goto("/judge");
  await page.getByTestId("W-JG-01.proofChip").click();
  const proof = page.getByTestId("W-PF-01");
  await expect(proof).toBeFocused();
  await expect(proof).toHaveAttribute("tabindex", "-1");
  const paragraph = proof.locator(".pf-figures__source");
  await expect(paragraph).toBeAttached();
  await page.mouse.move(640, 600);
  // Real wheel input cancels the helper's reveal settling. Stop with the paragraph mid-viewport;
  // locator.click must not hide an upward jump by scrolling it into view on our behalf.
  await expect
    .poll(async () => {
      const box = await paragraph.boundingBox();
      if (!box) return false;
      if (box.y >= 150 && box.y + box.height <= 650) return true;
      await page.mouse.wheel(0, box.y > 650 ? 300 : -150);
      return false;
    })
    .toBe(true);
  await paragraph.click();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Tab");
  // Assert the browser's actual sequential focus order, not just whether the temporary attribute went away.
  expect(
    await paragraph.evaluate((el) => {
      const active = document.activeElement;
      return (
        active !== document.body &&
        active !== el &&
        Boolean(active && el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  await expect(proof.getByTestId("W-PF-01.fees").locator("summary")).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before - 20);
  await expect(proof).not.toHaveAttribute("tabindex");
});
