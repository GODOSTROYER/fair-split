// The stage's one menu (UI gate round 4): the run pill's chevron holds the screens, Shortcuts, and the stage's own
// utilities (the run log, sound and Reset), so the top bar keeps six items. Tests reach those through it.

import { act, fireEvent, screen, within } from "@testing-library/react";

/** Opens the chevron menu (if it is not open yet) and returns its popup. */
export async function openStageMenu(): Promise<HTMLElement> {
  const open = screen.queryByTestId("W-JG-01.runPill.menuPopup");
  if (open) return open;
  await act(async () => {
    fireEvent.click(screen.getByTestId("W-JG-01.runPill.menu"));
  });
  return await screen.findByTestId("W-JG-01.runPill.menuPopup");
}

/** One of the menu's items, by its test ID (W-JG-01.logOpen, W-JG-01.sound, W-JG-01.reset), the menu opened. */
export async function stageMenuItem(testId: string): Promise<HTMLElement> {
  const popup = await openStageMenu();
  return within(popup).getByTestId(testId);
}

/** The item if the menu offers it, else null (Reset is offered only while there is a session to end). */
export async function queryStageMenuItem(testId: string): Promise<HTMLElement | null> {
  const popup = await openStageMenu();
  return within(popup).queryByTestId(testId);
}

/** Clicks a menu item: the menu closes, and the item's action runs. */
export async function clickStageMenuItem(testId: string): Promise<void> {
  const item = await stageMenuItem(testId);
  await act(async () => {
    fireEvent.click(item);
  });
}

/** Closes the menu with Escape, if it is open. */
export async function closeStageMenu(): Promise<void> {
  const open = screen.queryByTestId("W-JG-01.runPill.menuPopup");
  if (!open) return;
  await act(async () => {
    fireEvent.keyDown(open, { key: "Escape" });
  });
}
