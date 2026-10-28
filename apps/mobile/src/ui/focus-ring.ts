/**
 * When a slab draws its focus ring (S2.7; WCAG 2.4.7 focus visible): for keyboard focus, never for a click or a tap,
 * where the press itself is the feedback. Browsers answer this with `:focus-visible`; where one cannot, the last input
 * decides. Pure, so the rule is tested without a browser; `ui/slab.tsx` feeds it the DOM.
 */

export type InputModality = "keyboard" | "pointer";

/** Modifier keys held for a click (Shift-click, Ctrl-click) are not keyboard use. */
const MODIFIERS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

export function focusRingVisible(input: {
  /** Only the web draws the ring; Android draws its own focus highlight. */
  web: boolean;
  /** The element's `:focus-visible`, or null when the browser cannot say. */
  focusVisible: boolean | null;
  lastInput: InputModality | null;
}): boolean {
  if (!input.web) return false;
  if (input.focusVisible !== null) return input.focusVisible;
  return input.lastInput !== "pointer";
}

/** `el.matches(":focus-visible")`, or null for anything that is not an element or does not know the selector. */
export function focusVisibleOf(el: unknown): boolean | null {
  const m = el && typeof el === "object" ? (el as { matches?: unknown }).matches : undefined;
  if (typeof m !== "function") return null;
  try {
    return (m as (selector: string) => boolean).call(el, ":focus-visible") === true;
  } catch {
    return null;
  }
}

interface ListenerTarget {
  addEventListener(type: string, listener: (e: unknown) => void, options?: unknown): void;
}

/** Listens (capturing, passive) for keys and pointers on `target`; the returned function reads the last input. */
export function trackInputModality(target: ListenerTarget): () => InputModality | null {
  let last: InputModality | null = null;
  const opts = { capture: true, passive: true };
  target.addEventListener(
    "keydown",
    (e) => {
      const key = e && typeof e === "object" ? (e as { key?: unknown }).key : undefined;
      if (typeof key === "string" && MODIFIERS.has(key)) return;
      last = "keyboard";
    },
    opts,
  );
  for (const type of ["pointerdown", "mousedown", "touchstart"]) {
    target.addEventListener(
      type,
      () => {
        last = "pointer";
      },
      opts,
    );
  }
  return () => last;
}
