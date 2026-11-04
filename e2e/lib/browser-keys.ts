import type { Page } from "@playwright/test";
import { expect } from "./fixtures.js";

// Explicit scripted human steps. Play it for me must stop before either officer signs.
export async function treasurerKey(page: Page) {
  await expect(page.getByTestId("W-TR-07.approve.face")).toBeEnabled({ timeout: 90_000 });
  await expect(page.getByTestId("W-JG-01.autoplay")).toHaveAttribute("data-state", "paused");
  await page.getByTestId("W-TR-07.approve.alt").click();
  const signed = page.waitForResponse(
    (r) => /\/v1\/runs\/[^/]+\/approvals$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
  );
  await page.getByTestId("W-TR-07.approve.dialog.confirm.face").click();
  expect((await signed).status()).toBe(201);
}

export async function chairKey(page: Page) {
  await page.getByTestId("W-TR-07.cosign.frame").click();
  const phone = page.frameLocator('[data-testid="W-JG-01.frame.chair"]');
  await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request");
  await phone.getByTestId("M-BD-01.sign").click();
  await phone.getByTestId("M-BD-02.slab.another-way").click();
  const signed = page.waitForResponse(
    (r) => /\/v1\/runs\/[^/]+\/approvals$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
  );
  await phone.getByTestId("M-BD-02.slab.confirm.ok").click();
  expect((await signed).status()).toBe(201);
}
