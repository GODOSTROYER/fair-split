// The keys every surface answers (W-TR-10, S1.12): "?" opens the shortcut sheet and D toggles Data mode.
// Both are single keys, so the viewer can turn them off (WCAG 2.1.4) and they never fire while typing.
// The sheet itself is W-TR-10's (the proof slice), mounted here once.

import { useDataMode } from "../lib/data-mode.js";
import { useShortcut, useShortcuts } from "../lib/shortcuts.js";
import { ShortcutSheet } from "../screens/W-TR-10/index.js";

export function GlobalShortcuts() {
  const shortcuts = useShortcuts();
  const dataMode = useDataMode();
  useShortcut({
    id: "global.help",
    keys: "?",
    label: "Show the shortcuts",
    group: "General",
    run: () => shortcuts.setSheetOpen(!shortcuts.sheetOpen),
  });
  useShortcut({
    id: "global.data-mode",
    keys: "D",
    label: "Data mode: charts as plain tables",
    group: "General",
    run: () => dataMode.toggle(),
  });
  return <ShortcutSheet open={shortcuts.sheetOpen} onOpenChange={shortcuts.setSheetOpen} />;
}
