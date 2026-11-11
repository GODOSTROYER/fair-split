// The stage's one menu (UI gate round 4): the top bar keeps six items, and the run log, sound and Reset live in the
// run pill's chevron menu (W-JG-01.runPill.menu). Specs reach them through it.
import type { Page } from "@playwright/test";

/** Opens the chevron menu and waits for its popup. */
export async function openStageMenu(page: Page): Promise<void> {
  const popup = page.getByTestId("W-JG-01.runPill.menuPopup");
  if (await popup.isVisible()) return;
  await page.getByTestId("W-JG-01.runPill.menu").click();
  await popup.waitFor({ state: "visible" });
}

/** Reset, from the chevron menu: the menu closes and the stage goes back to the first press. */
export async function resetFromMenu(page: Page): Promise<void> {
  await openStageMenu(page);
  await page.getByRole("menuitem", { name: "Reset" }).click();
}
