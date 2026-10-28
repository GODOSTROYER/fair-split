// Focus that never falls to <body> (WCAG 2.4.3). Two cases the console meets on its hero path:
//   - a control that held focus is removed by the answer it asked for ("Count it once", "Pay in cash", a trace's
//     Close): `useFocusAfterRemoval` moves focus to the place that now says what happened;
//   - a drawer or a trace closes: `restoreFocus` hands focus back to what opened it, once the DOM has settled,
//     and only when nothing else took focus meanwhile (a new screen's pre-focused control wins).

import { useEffect, useRef } from "react";

function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * Watches `root` (an element from a callback ref, so the watch starts when it mounts): when the element focused
 * inside it is removed and focus fell to <body>, focuses `target()`. A focus the person moved elsewhere is left
 * alone.
 */
export function useFocusAfterRemoval(root: HTMLElement | null, target: () => HTMLElement | null): void {
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const el = root;
    if (!el) return;
    let last: Element | null = el.contains(document.activeElement) ? document.activeElement : null;
    const onIn = (event: FocusEvent) => {
      last = event.target instanceof Element ? event.target : null;
    };
    const onOut = (event: FocusEvent) => {
      // Focus went somewhere else on purpose: nothing to keep.
      if (event.relatedTarget instanceof Node && !el.contains(event.relatedTarget)) last = null;
    };
    const observer = new MutationObserver(() => {
      if (!last || last.isConnected || !focusLost()) return;
      last = null;
      targetRef.current()?.focus({ preventScroll: true });
    });
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
      observer.disconnect();
    };
  }, [root]);
}

/**
 * After the DOM settles, focuses `opener` (or `fallback()` when the opener is gone), but only if focus was lost:
 * a control another screen pre-focused meanwhile keeps it.
 */
export function restoreFocus(
  opener: HTMLElement | null,
  fallback: () => HTMLElement | null = () => null,
): void {
  setTimeout(() => {
    if (!focusLost()) return;
    const target = opener?.isConnected ? opener : fallback();
    target?.focus({ preventScroll: true });
  }, 0);
}
