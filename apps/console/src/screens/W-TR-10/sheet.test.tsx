// W-TR-10 Shortcuts and settings, and Data mode: "?" opens the sheet with every registered key grouped by task and
// S1.7's three toggles; single keys can be turned off (WCAG 2.1.4); D swaps charts for tables, said once and shown
// by a small plate with the way back.

import { webRoutes } from "@fairsplit/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { keysLabel, keysSpoken } from "../../features/shortcuts/ShortcutSheet.js";
import { expectNoAxeViolations, renderConsole } from "../../test/index.js";

describe("W-TR-10 the shortcut sheet", () => {
  it("opens on ?, lists the registered keys by task, and is clean for axe", async () => {
    const view = await renderConsole({ path: webRoutes.ops() });
    await screen.findByTestId("W-OP-01");
    fireEvent.keyDown(window, { key: "?" });
    const sheet = await screen.findByTestId("W-TR-10");
    expect(sheet.dataset.state).toBe("open");
    const general = screen.getByTestId("W-TR-10.group.General");
    expect(within(general).getByTestId("W-TR-10.shortcut.global.help").textContent).toContain(
      "Show the shortcuts",
    );
    expect(within(general).getByTestId("W-TR-10.shortcut.global.data-mode").textContent).toContain(
      "Data mode",
    );
    expect(screen.getByTestId("W-TR-10.group.Read").textContent).toContain("The reading room adds");
    await expectNoAxeViolations(document.body);
    fireEvent.click(screen.getByTestId("W-TR-10.close"));
    await waitFor(() => expect(screen.queryByTestId("W-TR-10")).toBeNull());
    view.unmount();
  });

  it("turns single keys off (WCAG 2.1.4): ? and D stop answering until they're back on", async () => {
    await renderConsole({ path: webRoutes.ops() });
    await screen.findByTestId("W-OP-01");
    fireEvent.keyDown(window, { key: "?" });
    await screen.findByTestId("W-TR-10");
    fireEvent.click(screen.getByTestId("W-TR-10.singleKeys"));
    expect(screen.getByTestId("W-TR-10.singleKeys").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("W-TR-10.shortcut.global.help").hasAttribute("data-off")).toBe(true);
    fireEvent.click(screen.getByTestId("W-TR-10.close"));
    await waitFor(() => expect(screen.queryByTestId("W-TR-10")).toBeNull());
    fireEvent.keyDown(window, { key: "D" });
    fireEvent.keyDown(window, { key: "?" });
    expect(document.documentElement.hasAttribute("data-datamode")).toBe(false);
    expect(screen.queryByTestId("W-TR-10")).toBeNull();
  });

  it("names keys the way they're printed and spoken", () => {
    expect(keysLabel("Mod+K")).toBe("Ctrl K");
    expect(keysLabel("Mod+K", true)).toBe("⌘ K");
    expect(keysLabel("Escape")).toBe("Esc");
    expect(keysSpoken("?")).toBe("question mark");
    expect(keysSpoken("ArrowDown")).toBe("down arrow");
  });
});

describe("W-TR-10 Data mode", () => {
  it("switches from the sheet or D, says so once, and shows the way back", async () => {
    await renderConsole({ path: webRoutes.ops() });
    await screen.findByTestId("W-OP-01");
    fireEvent.keyDown(window, { key: "?" });
    await screen.findByTestId("W-TR-10");
    fireEvent.click(screen.getByTestId("W-TR-10.dataMode"));
    expect(document.documentElement.hasAttribute("data-datamode")).toBe(true);
    // The plate stays out of the way while the sheet is open.
    expect(screen.queryByTestId("W-TR-10.datamode")).toBeNull();
    fireEvent.click(screen.getByTestId("W-TR-10.close"));
    const badge = await screen.findByTestId("W-TR-10.datamode");
    expect(badge.textContent).toContain("Charts read as tables.");
    await waitFor(() =>
      expect(screen.getByTestId("announcer").textContent).toBe("Data mode on: charts read as tables."),
    );
    await expectNoAxeViolations(document.body);
    fireEvent.click(screen.getByTestId("W-TR-10.datamode.off"));
    expect(document.documentElement.hasAttribute("data-datamode")).toBe(false);
    expect(screen.queryByTestId("W-TR-10.datamode")).toBeNull();
    fireEvent.keyDown(window, { key: "d" });
    expect(document.documentElement.hasAttribute("data-datamode")).toBe(true);
  });
});
