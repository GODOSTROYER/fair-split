// W-TR-10 Shortcuts and settings sheet: SHELL PLACEHOLDER (working), restyled and extended by the proof slice
// (SPLIT.md). Opened with "?" or Shortcuts in the rail and the run pill's menu. It lists what the mounted
// screens registered, grouped by task, and the three toggles S1.7 names: single-key shortcuts (WCAG 2.1.4),
// sound and Data mode.

import { Dialog } from "@base-ui/react/dialog";
import { Glyph } from "@fairsplit/ui-web";
import { useDataMode } from "../../lib/data-mode.js";
import { SHORTCUT_GROUPS, type ShortcutSpec, useShortcuts } from "../../lib/shortcuts.js";
import { useSound } from "../../sound/sound.js";
import type { ShortcutSheetProps } from "../contract.js";

function Toggle({
  label,
  on,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
  readonly testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="fsc-toggle"
      onClick={() => onChange(!on)}
      data-testid={testId}
    >
      <span className="fsc-toggle__track" aria-hidden>
        <span className="fsc-toggle__thumb" />
      </span>
      <span className="fs-t-label">{label}</span>
    </button>
  );
}

function keysLabel(keys: string): string {
  return keys.replace("Mod+", "Ctrl ").replace("Space", "Space bar");
}

export function ShortcutSheet({ open, onOpenChange }: ShortcutSheetProps) {
  const shortcuts = useShortcuts();
  const sound = useSound();
  const dataMode = useDataMode();
  const groups = SHORTCUT_GROUPS.map((group) => ({
    group,
    items: shortcuts.list.filter((s: ShortcutSpec) => s.group === group),
  })).filter((g) => g.items.length > 0);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fsc-sheet__scrim" />
        <Dialog.Popup
          className="fsc-sheet fsc-sheet--narrow"
          data-testid="W-TR-10"
          data-state={open ? "open" : "closed"}
        >
          <header className="fsc-sheet__head">
            <Dialog.Title className="fs-t-title-1">Shortcuts</Dialog.Title>
            <Dialog.Close className="fsc-sheet__close" data-testid="W-TR-10.close">
              <Glyph name="ms:close" size={18} />
              <span className="fs-t-label">Close</span>
            </Dialog.Close>
          </header>
          <Dialog.Description className="fsc-sheet__lede">
            Keys work while the console has focus. Single keys never fire while you type.
          </Dialog.Description>
          <div className="fsc-toggles" data-testid="W-TR-10.toggles">
            <Toggle
              label="Single-key shortcuts"
              on={shortcuts.singleKeys}
              onChange={shortcuts.setSingleKeys}
              testId="W-TR-10.singleKeys"
            />
            <Toggle label="Sound" on={sound.on} onChange={sound.set} testId="W-TR-10.sound" />
            <Toggle label="Data mode" on={dataMode.on} onChange={dataMode.set} testId="W-TR-10.dataMode" />
          </div>
          <dl className="fsc-ledger">
            {groups.map(({ group, items }) => (
              <div key={group} className="fsc-ledger__row">
                <dt className="fsc-ledger__term fs-t-label">{group}</dt>
                <dd className="fsc-ledger__items">
                  <ul>
                    {items.map((item) => (
                      <li key={item.id} className="fsc-shortcut">
                        <kbd className="fsc-kbd">{keysLabel(item.keys)}</kbd>
                        <span>{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
