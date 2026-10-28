// W-TR-10 Shortcuts and settings (a sheet opened with "?", Shortcuts in the rail, or the run pill's menu) and Data
// mode (D). Mounted once at the root by the shell's GlobalShortcuts: the sheet lists what the mounted screens
// registered, grouped by task, with S1.7's three toggles; Data mode's plate shows on every surface while it is on.

import { DataModeBadge } from "../../features/datamode/DataModeBadge.js";
import { ShortcutSheetView } from "../../features/shortcuts/ShortcutSheet.js";
import type { ShortcutSheetProps } from "../contract.js";
import "../../features/shortcuts/sheet.css";
import "../../features/datamode/datamode.css";

export function ShortcutSheet({ open, onOpenChange }: ShortcutSheetProps) {
  return (
    <>
      <ShortcutSheetView open={open} onOpenChange={onOpenChange} />
      <DataModeBadge />
    </>
  );
}
