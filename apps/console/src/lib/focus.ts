// Focus that never falls to <body> (WCAG 2.4.3). The cases the console meets on its hero path:
//   - a control that held focus is removed by the answer it asked for ("Count it once", "Pay in cash", a slip's
//     zoom controls): `useFocusAfterRemoval` moves focus to the place that now says what happened;
//   - a trace closes: `focusIfLost`, from a layout effect after the commit that removed it, hands focus back to
//     the peso that opened it;
//   - a drawer closes: `restoreFocus`, from the drawer's own cleanup, hands focus back to what opened it;
//   - the phone lowers from over the scrim: Stage, from a layout effect after that commit (the console is live
//     again), focuses what raised it.
// Each acts after React has committed the removal, and only when focus fell to <body> (a control the person or a
// new screen focused meanwhile keeps it; the phone's opener takes focus back from the panel going inert). A timer
// alone is never the wait: on a loaded machine it can fire before React commits, find the control still focused
// (or the console still inert), and give up just before focus falls to <body>.

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
 * Focuses `target` (or `fallback()` when it is gone) if focus fell to <body>. Call it once the commit that removed
 * the focused control has landed: from a layout effect that runs after that commit, or from the cleanup of the
 * component that went (React runs it after removing its DOM).
 */
export function focusIfLost(
  target: HTMLElement | null | undefined,
  fallback: () => HTMLElement | null = () => null,
): void {
  if (!focusLost()) return;
  const found = target?.isConnected ? target : fallback();
  found?.focus({ preventScroll: true });
}

/**
 * From the cleanup of a component that held focus (a drawer: React runs it after the commit that removed the
 * drawer, so its controls are already gone): focuses `opener` (or `fallback()` when the opener is gone) if focus
 * fell to <body>, one task later, once the other cleanups of that commit have run (the screen the drawer covered
 * is no longer inert). A control another screen pre-focused meanwhile keeps it. Never call it before that commit
 * (from an event handler, or an effect that is about to remove the control): use `focusIfLost` after it instead.
 */
export function restoreFocus(
  opener: HTMLElement | null | (() => HTMLElement | null),
  fallback: () => HTMLElement | null = () => null,
): void {
  setTimeout(() => {
    // A getter finds the opener after the re-render (a row redrawn since it was pressed).
    focusIfLost(typeof opener === "function" ? opener() : opener, fallback);
  }, 0);
}
