// Keyboard shortcuts (W-TR-10, S1.12): screens register keys while mounted; single keys never fire while the
// viewer types and can be turned off (WCAG 2.1.4); scoped keys (J and K on a row list) act only while focus is
// inside their element and win over global ones.

import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  isTypingTarget,
  matchKey,
  type ShortcutSpec,
  ShortcutsProvider,
  useShortcut,
  useShortcuts,
} from "./shortcuts.js";

function Register({
  spec,
}: {
  readonly spec: Omit<ShortcutSpec, "group"> & { group?: ShortcutSpec["group"] };
}) {
  useShortcut({ group: "General", ...spec });
  return null;
}

function Scoped({ onNext }: { readonly onNext: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useShortcut({ id: "rows.next", keys: "J", label: "Next row", group: "Review", scope: ref, run: onNext });
  return (
    <div ref={ref} data-testid="rows">
      <button type="button">row</button>
    </div>
  );
}

function Toggle() {
  const shortcuts = useShortcuts();
  return (
    <button type="button" data-testid="toggle" onClick={() => shortcuts.setSingleKeys(!shortcuts.singleKeys)}>
      {shortcuts.singleKeys ? "on" : "off"} {shortcuts.list.length}
    </button>
  );
}

describe("keyboard shortcuts", () => {
  it("matches keys the way the sheet writes them", () => {
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
      ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;
    expect(matchKey(key("d"), "D")).toBe(true);
    expect(matchKey(key("D", { shiftKey: true }), "D")).toBe(true);
    expect(matchKey(key("d", { ctrlKey: true }), "D")).toBe(false);
    expect(matchKey(key("?", { shiftKey: true }), "?")).toBe(true);
    expect(matchKey(key(" "), "Space")).toBe(true);
    expect(matchKey(key("k", { metaKey: true }), "Mod+K")).toBe(true);
    expect(matchKey(key("Escape"), "Escape")).toBe(true);
  });

  it("never fires a single key while the viewer types", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    const run = vi.fn();
    const view = render(
      <ShortcutsProvider>
        <Register spec={{ id: "t", keys: "D", label: "Data mode", run }} />
        <input data-testid="field" />
      </ShortcutsProvider>,
    );
    fireEvent.keyDown(view.getByTestId("field"), { key: "d" });
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "d" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets the viewer turn single keys off, remembered per viewer (WCAG 2.1.4)", () => {
    const run = vi.fn();
    const view = render(
      <ShortcutsProvider>
        <Register spec={{ id: "t", keys: "D", label: "Data mode", run }} />
        <Register spec={{ id: "esc", keys: "Escape", label: "Close", run: () => undefined }} />
        <Toggle />
      </ShortcutsProvider>,
    );
    act(() => view.getByTestId("toggle").click());
    expect(view.getByTestId("toggle").textContent).toBe("off 2");
    fireEvent.keyDown(document.body, { key: "d" });
    expect(run).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("fs.shortcuts")).toBe("off");
  });

  it("acts on a scoped key only while focus is inside its element", () => {
    const next = vi.fn();
    const view = render(
      <ShortcutsProvider>
        <Scoped onNext={next} />
        <button type="button" data-testid="elsewhere">
          elsewhere
        </button>
      </ShortcutsProvider>,
    );
    view.getByTestId("elsewhere").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "j" });
    expect(next).not.toHaveBeenCalled();
    view.getByText("row").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "j" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("unregisters a screen's keys when it unmounts", () => {
    const view = render(
      <ShortcutsProvider>
        <Register spec={{ id: "t", keys: "D", label: "Data mode", run: () => undefined }} />
        <Toggle />
      </ShortcutsProvider>,
    );
    expect(view.getByTestId("toggle").textContent).toBe("on 1");
    view.rerender(
      <ShortcutsProvider>
        <Toggle />
      </ShortcutsProvider>,
    );
    expect(view.getByTestId("toggle").textContent).toBe("on 0");
  });
});
