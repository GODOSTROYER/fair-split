// Data mode (W-TR-10, D): every chart reads as a plain table and the seal as its hash (S1.7). Turning it on changes
// the whole screen, so the change is said once (the polite announcer) and a small plate stays on screen while it
// is on, with the way back. It sits in the corner on every surface (stage, Proof, /ops) and never moves.

import { Glyph } from "@fairsplit/ui-web";
import { useEffect, useRef } from "react";
import { useAnnounce } from "../../lib/announce.js";
import { useDataMode } from "../../lib/data-mode.js";
import { FocusReturn } from "../../lib/focus.js";
import { useShortcuts } from "../../lib/shortcuts.js";

export const DATA_MODE_COPY = {
  on: "Data mode on: charts read as tables.",
  off: "Data mode off: charts are back.",
  badge: "Data mode",
  badgeNote: "Charts read as tables.",
  turnOff: "Turn off",
  keyHint: "or press D",
} as const;

export function DataModeBadge() {
  const dataMode = useDataMode();
  const shortcuts = useShortcuts();
  const announce = useAnnounce();
  const previous = useRef(dataMode.on);

  // The change is said once, only when a person switched it (not on the first render of a remembered choice).
  useEffect(() => {
    if (previous.current === dataMode.on) return;
    previous.current = dataMode.on;
    announce(dataMode.on ? DATA_MODE_COPY.on : DATA_MODE_COPY.off);
  }, [dataMode.on, announce]);

  if (!dataMode.on || shortcuts.sheetOpen) return null;
  return (
    <aside
      className="dm-badge"
      aria-label={DATA_MODE_COPY.badge}
      title={`${DATA_MODE_COPY.badgeNote}${shortcuts.singleKeys ? ` Turn off here, ${DATA_MODE_COPY.keyHint}.` : ""}`}
      data-testid="W-TR-10.datamode"
    >
      {/* "Turn off" takes the plate away with the focus it holds: back to where it was, never <body>. */}
      <FocusReturn open leaving={() => document.querySelector('[data-testid="W-TR-10.datamode"]')} />
      <Glyph name="logbook" size={16} />
      <span className="dm-badge__title">{DATA_MODE_COPY.badge}</span>
      <span className="fs-sr">{DATA_MODE_COPY.badgeNote}</span>
      <button
        type="button"
        className="fs-link fs-t-label"
        onClick={() => dataMode.set(false)}
        data-testid="W-TR-10.datamode.off"
      >
        {DATA_MODE_COPY.turnOff}
      </button>
    </aside>
  );
}
