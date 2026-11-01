// Keyboard shortcuts infrastructure (W-TR-10, S1.12). One keydown listener; screens register what they
// handle while mounted. Single-key shortcuts (D, ?, J, K) can be turned off (WCAG 2.1.4), never fire while
// typing, and J and K act only while their row list has focus (`scope`). The shortcut sheet (W-TR-10, the
// proof slice) lists `useShortcuts().list`, grouped by task.

import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readFlag, writeFlag } from "./storage.js";

/** S1.7: grouped by task. "General" holds the stage-wide keys (?, D). */
export const SHORTCUT_GROUPS = ["General", "Read", "Review", "Approve", "Run"] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface ShortcutSpec {
  /** Unique, e.g. "split.next-row". */
  readonly id: string;
  /** "?", "D", "J", "K", "Enter", "Space", "Escape", "ArrowDown", "Mod+K" (Mod is Cmd on macOS, else Ctrl). */
  readonly keys: string;
  /** What it does, in the console's words: "Next row". */
  readonly label: string;
  readonly group: ShortcutGroup;
  /** Only while focus is inside this element (J and K on a row list). */
  readonly scope?: RefObject<HTMLElement | null>;
  /** Extra condition, checked at key time. */
  readonly when?: () => boolean;
  readonly run: (event: KeyboardEvent) => void;
}

export const SINGLE_KEYS_STORAGE = "fs.shortcuts";

/** A printable key with no modifier: what WCAG 2.1.4 lets people turn off. */
export function isSingleKey(keys: string): boolean {
  return keys.length === 1;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return el.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") !== null;
}

/** Does this key event press `keys`? Single letters ignore case; modifiers must match exactly. */
export function matchKey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  keys: string,
): boolean {
  if (keys.startsWith("Mod+")) {
    const key = keys.slice(4).toLowerCase();
    return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === key;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (keys === "Space") return event.key === " " || event.key === "Spacebar";
  if (keys.length === 1) {
    // "?" needs Shift on most layouts; letters match either case.
    return keys === "?" ? event.key === "?" : event.key.toLowerCase() === keys.toLowerCase();
  }
  return event.key === keys && !event.shiftKey;
}

export interface ShortcutsApi {
  /** Every registered shortcut, for the sheet. */
  readonly list: readonly ShortcutSpec[];
  /** WCAG 2.1.4: single-key shortcuts on or off (remembered per viewer). */
  readonly singleKeys: boolean;
  setSingleKeys(on: boolean): void;
  readonly sheetOpen: boolean;
  setSheetOpen(open: boolean): void;
  register(spec: ShortcutSpec): () => void;
}

const ShortcutsContext = createContext<ShortcutsApi | null>(null);

export function ShortcutsProvider({
  children,
  target,
}: {
  readonly children: ReactNode;
  /** Where to listen; the window by default (tests pass their own). */
  readonly target?: Pick<Window, "addEventListener" | "removeEventListener">;
}) {
  const [list, setList] = useState<readonly ShortcutSpec[]>([]);
  const [singleKeys, setSingleKeysState] = useState(() => readFlag(SINGLE_KEYS_STORAGE, true));
  const [sheetOpen, setSheetOpen] = useState(false);
  const registry = useRef<ShortcutSpec[]>([]);
  const singleRef = useRef(singleKeys);
  singleRef.current = singleKeys;

  const register = useCallback((spec: ShortcutSpec) => {
    registry.current = [...registry.current.filter((s) => s.id !== spec.id), spec];
    setList(registry.current);
    return () => {
      registry.current = registry.current.filter((s) => s !== spec);
      setList(registry.current);
    };
  }, []);

  const setSingleKeys = useCallback((on: boolean) => {
    setSingleKeysState(on);
    writeFlag(SINGLE_KEYS_STORAGE, on);
  }, []);

  useEffect(() => {
    const host = target ?? window;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const typing = isTypingTarget(event.target);
      const active = typeof document === "undefined" ? null : document.activeElement;
      const candidates = [...registry.current].reverse();
      // Scoped shortcuts (focus inside their element) win over global ones.
      const ordered = [...candidates.filter((s) => s.scope), ...candidates.filter((s) => !s.scope)];
      for (const spec of ordered) {
        if (!matchKey(event, spec.keys)) continue;
        if (isSingleKey(spec.keys) && (!singleRef.current || typing)) continue;
        if (spec.scope) {
          const el = spec.scope.current;
          if (!el || !active || !el.contains(active)) continue;
        }
        if (spec.when && !spec.when()) continue;
        event.preventDefault();
        spec.run(event);
        return;
      }
    };
    host.addEventListener("keydown", onKey as EventListener);
    return () => host.removeEventListener("keydown", onKey as EventListener);
  }, [target]);

  const value = useMemo(
    () => ({ list, singleKeys, setSingleKeys, sheetOpen, setSheetOpen, register }),
    [list, singleKeys, setSingleKeys, sheetOpen, register],
  );
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export function useShortcuts(): ShortcutsApi {
  const api = useContext(ShortcutsContext);
  if (!api) throw new Error("useShortcuts needs a <ShortcutsProvider> above it.");
  return api;
}

/** Registers a shortcut while the calling component is mounted. `run` may change between renders. */
export function useShortcut(spec: ShortcutSpec): void {
  const { register } = useShortcuts();
  const latest = useRef(spec);
  latest.current = spec;
  const { id, keys, label, group, scope } = spec;
  useEffect(
    () =>
      register({
        id,
        keys,
        label,
        group,
        scope,
        when: () => latest.current.when?.() ?? true,
        run: (event) => latest.current.run(event),
      }),
    [register, id, keys, label, group, scope],
  );
}
