// W-TR-10 Shortcuts and settings (S1.7, design C10): a sheet opened with "?" or "Shortcuts". It lists what the
// mounted screens registered, grouped by task, and holds S1.7's three toggles: single-key shortcuts (WCAG 2.1.4),
// sound and Data mode. Every key is a real binding from the registry: nothing here is a promise a screen doesn't keep.

import { Dialog } from "@base-ui/react/dialog";
import { Glyph } from "@fairsplit/ui-web";
import { useDataMode } from "../../lib/data-mode.js";
import { FocusReturn } from "../../lib/focus.js";
import {
  isSingleKey,
  SHORTCUT_GROUPS,
  type ShortcutGroup,
  type ShortcutSpec,
  useShortcuts,
} from "../../lib/shortcuts.js";
import { useSound } from "../../sound/sound.js";

export const SHEET_COPY = {
  title: "Shortcuts and settings",
  lede: "Keys work while the console has focus. Single keys never fire while you type.",
  close: "Close",
  toggles: "Settings",
  singleKeys: "Single-key shortcuts",
  singleKeysNote: "D, ?, J and K. Turn them off if they get in the way of a screen reader or voice control.",
  sound: "Sound",
  soundNote: "Payments play a chord. Off until you turn it on; never under narration.",
  dataMode: "Data mode",
  dataModeNote: "The dial, the fan, the arc and the waffle read as plain tables; the seal reads as its hash.",
  keysOff: "Off: single keys are turned off.",
  here: "On this screen",
  empty: (where: string) => `Nothing to press here. ${where}`,
} as const;

/** Where each group's keys live, for the groups the current screen doesn't use. */
export const GROUP_WHERE: Readonly<Record<ShortcutGroup, string>> = {
  General: "These work everywhere.",
  Read: "The reading room adds J, K, Space and Enter.",
  Review: "Split review adds J, K and Enter on its lines.",
  Approve: "Approve adds the hold on Space.",
  Run: "The run adds its keys while it is open.",
};

/** "Mod+K" → "Ctrl K" (⌘ K on Apple keyboards), "Space" stays a word, single keys stay as they are. */
export function keysLabel(keys: string, apple = false): string {
  if (keys.startsWith("Mod+")) return `${apple ? "⌘" : "Ctrl"} ${keys.slice(4).toUpperCase()}`;
  if (keys === "Escape") return "Esc";
  if (keys === "ArrowDown") return "↓";
  if (keys === "ArrowUp") return "↑";
  return keys;
}

/** What a screen reader hears for a key: the words, never the symbol. */
export function keysSpoken(keys: string): string {
  if (keys === "?") return "question mark";
  if (keys === "ArrowDown") return "down arrow";
  if (keys === "ArrowUp") return "up arrow";
  if (keys.startsWith("Mod+")) return `control ${keys.slice(4)}`;
  return keys;
}

export function groupShortcuts(list: readonly ShortcutSpec[]) {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    items: list.filter((s) => s.group === group).sort((a, b) => a.keys.localeCompare(b.keys)),
  }));
}

function isApple(): boolean {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  } catch {
    return false;
  }
}

function Toggle({
  label,
  note,
  on,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly note: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
  readonly testId: string;
}) {
  const noteId = `${testId}-note`.replace(/\./g, "-");
  return (
    <div className="sc-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={noteId}
        className="fsc-toggle"
        onClick={() => onChange(!on)}
        data-testid={testId}
        data-state={on ? "on" : "off"}
      >
        <span className="fsc-toggle__track" aria-hidden>
          <span className="fsc-toggle__thumb" />
        </span>
        <span className="fs-t-label">{label}</span>
        <span className="sc-toggle__word" aria-hidden>
          {on ? "On" : "Off"}
        </span>
      </button>
      <p className="sc-toggle__note" id={noteId}>
        {note}
      </p>
    </div>
  );
}

export interface ShortcutSheetViewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShortcutSheetView({ open, onOpenChange }: ShortcutSheetViewProps) {
  const shortcuts = useShortcuts();
  const sound = useSound();
  const dataMode = useDataMode();
  const apple = isApple();
  const groups = groupShortcuts(shortcuts.list);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fsc-sheet__scrim" />
        <Dialog.Popup
          finalFocus={false}
          className="fsc-sheet fsc-sheet--narrow sc-sheet"
          data-testid="W-TR-10"
          data-state={open ? "open" : "closed"}
        >
          {/* Closing hands focus back to where "?" was pressed, through the console's one return (lib/focus.ts). */}
          <FocusReturn open={open} leaving={() => document.querySelector('[data-testid="W-TR-10"]')} />
          <header className="fsc-sheet__head">
            <Dialog.Title className="fs-t-title-1">{SHEET_COPY.title}</Dialog.Title>
            <Dialog.Close className="fsc-sheet__close" data-testid="W-TR-10.close">
              <Glyph name="ms:close" size={18} />
              <span className="fs-t-label">{SHEET_COPY.close}</span>
            </Dialog.Close>
          </header>
          <Dialog.Description className="fsc-sheet__lede">{SHEET_COPY.lede}</Dialog.Description>
          <section className="sc-toggles" aria-label={SHEET_COPY.toggles} data-testid="W-TR-10.toggles">
            <Toggle
              label={SHEET_COPY.singleKeys}
              note={SHEET_COPY.singleKeysNote}
              on={shortcuts.singleKeys}
              onChange={shortcuts.setSingleKeys}
              testId="W-TR-10.singleKeys"
            />
            <Toggle
              label={SHEET_COPY.sound}
              note={SHEET_COPY.soundNote}
              on={sound.on}
              onChange={sound.set}
              testId="W-TR-10.sound"
            />
            <Toggle
              label={SHEET_COPY.dataMode}
              note={SHEET_COPY.dataModeNote}
              on={dataMode.on}
              onChange={dataMode.set}
              testId="W-TR-10.dataMode"
            />
          </section>
          <div className="sc-groups" data-testid="W-TR-10.groups">
            {groups.map(({ group, items }) => (
              <section
                key={group}
                className="sc-group"
                data-group={group}
                data-testid={`W-TR-10.group.${group}`}
              >
                <h3 className="sc-group__title">{group}</h3>
                {items.length === 0 ? (
                  <p className="sc-group__empty">{SHEET_COPY.empty(GROUP_WHERE[group])}</p>
                ) : (
                  <ul className="sc-list">
                    {items.map((item) => {
                      const off = isSingleKey(item.keys) && !shortcuts.singleKeys;
                      return (
                        <li
                          key={item.id}
                          className="sc-item"
                          data-off={off ? "" : undefined}
                          data-testid={`W-TR-10.shortcut.${item.id}`}
                        >
                          <kbd className="fsc-kbd" aria-hidden>
                            {keysLabel(item.keys, apple)}
                          </kbd>
                          <span className="fs-sr">{keysSpoken(item.keys)}: </span>
                          <span className="sc-item__label">{item.label}</span>
                          {off && <span className="sc-item__off">{SHEET_COPY.keysOff}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
