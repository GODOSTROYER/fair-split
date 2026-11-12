// The console's one drawer frame (S1.6 "Drawers", design §2.4): W-TR-06 (the hold drawer) and W-TR-09 (the
// member line) render inside it. It portals beside the screen, so it never scrolls with the grid, and it
// follows the stage's width: it pushes the screen aside below 1600 px (full width below 1280) and overlays
// it at 560 px from 1600 over the scrim. Plate-2 with a 1 px top highlight; Esc and Close end it. Outside
// the stage (component tests) it renders in place.
// Round 5 (no dead bands): a drawer either hugs its content (`hug`: it ends at its content's foot) or pins its action
// to a sticky footer (`footer`), so a short drawer never shows an empty band; a compact success state drops the
// blocking scrim (`scrim={false}`) and leaves the screen lit and live.

import { Glyph } from "@fairsplit/ui-web";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  type FocusPlace,
  focusAndReveal,
  rememberFocus,
  returnFocus,
  useFocusAfterRemoval,
} from "../lib/focus.js";
import { useShortcut } from "../lib/shortcuts.js";
import { useOptionalStage } from "../stage/context.js";
import type { DrawerMode } from "../stage/layout.js";
import { DRAWER } from "./copy.js";
import { ChromePortal, useChromeSlotTarget } from "./slots.js";

export interface StageDrawerProps {
  /** What the drawer holds, for its landmark name: "Hold H1", "Nang Celing's line". */
  readonly label: string;
  /** A short line above the content, beside Close: "1 of 3" or the member number. Plain words. */
  readonly meta?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** `{screenId}.drawer`, e.g. "W-TR-06.drawer". */
  readonly testId: string;
  /** Forces a mode (tests); defaults to the stage's layout. */
  readonly mode?: DrawerMode;
  /**
   * The drawer's action, pinned to a sticky footer (round 5: no dead band under a short drawer's content): the
   * primary, and at most one secondary beside it at the same 48 px height.
   */
  readonly footer?: ReactNode;
  /**
   * Hug the content (round 5): the drawer ends at its content's foot (never past the stage's), so a short state
   * (a resolved hold) is a compact card, not a 1,000 px panel with an empty band.
   */
  readonly hug?: boolean;
  /**
   * Lay the blocking scrim over the screen (default, from 1,600 px). A compact success state passes false: the
   * screen stays lit and live beside it.
   */
  readonly scrim?: boolean;
}

export function StageDrawer({
  label,
  meta,
  onClose,
  children,
  testId,
  mode,
  footer,
  hug = false,
  scrim = true,
}: StageDrawerProps) {
  const stage = useOptionalStage();
  const target = useChromeSlotTarget("console.drawer");
  const resolved: DrawerMode = mode ?? stage?.layout.drawer ?? "overlay";
  const ref = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useShortcut({
    id: "drawer.close",
    keys: "Escape",
    label: "Close the drawer",
    group: "Review",
    run: () => close.current(),
  });

  // Covering the screen (full width below 1280 px, over the scrim from 1600 px), the drawer takes the keyboard:
  // the screen under it is inert, so Tab never lands on a control the drawer hides (S1.12, WCAG 2.4.11). Pushing
  // it aside (1280-1599 px), the screen stays live beside it. Declared before the focus effect below: closing,
  // React runs this cleanup first, so the screen is live again by the time focus goes back to it.
  const covers = Boolean(stage && target) && (resolved === "push-full" || (resolved === "overlay" && scrim));
  useLayoutEffect(() => {
    if (!covers) return;
    const main = document.getElementById("fsc-main");
    if (!main) return;
    main.setAttribute("inert", "");
    return () => main.removeAttribute("inert");
  }, [covers]);

  // Round 7: the stage knows a drawer stands beside the screen (it folds the console rail below 1440 px).
  const noteDrawer = stage && target ? stage.noteDrawer : undefined;
  useLayoutEffect(() => {
    if (!noteDrawer) return;
    noteDrawer(true);
    return () => noteDrawer(false);
  }, [noteDrawer]);

  // What opened the drawer (a grid row, a link), with its key, as the drawer first renders: before anything
  // inside it takes focus.
  const opener = useRef<FocusPlace | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = rememberFocus();

  // Focus lands on the drawer's title when it opens (its name is read out; no ring frames the whole drawer),
  // unless something inside already took it (a pre-focused slab). Closing hands focus back to what opened it, to
  // its successor when the grid drew that row again, or to the screen when it is gone (WCAG 2.4.3): in the commit
  // that removes the drawer, before its DOM goes, so no frame is painted with focus on <body>.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.contains(document.activeElement)) focusAndReveal(title.current ?? el);
    const from = opener.current ?? null;
    return () => {
      returnFocus(from, { leaving: el });
    };
  }, []);

  // The same drawer moving to another subject ("Next: hold H2") reads its new name out.
  const named = useRef(label);
  useEffect(() => {
    if (named.current === label) return;
    named.current = label;
    const el = ref.current;
    if (el && (el.contains(document.activeElement) || document.activeElement === document.body)) {
      focusAndReveal(title.current ?? el);
    }
  }, [label]);

  // A control the answer removes ("Count it once") leaves focus on the drawer's result line, or its title.
  const [aside, setAside] = useState<HTMLElement | null>(null);
  useFocusAfterRemoval(aside, () => aside?.querySelector<HTMLElement>("[data-focus-after]") ?? title.current);

  const drawer = (
    <>
      {resolved === "overlay" && scrim && (
        <div
          className="fsc-drawer-scrim"
          // A press on the scrim never moves focus to <body> first (a browser's default for a surface that takes
          // none): focus stays in the drawer until the close hands it back.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => close.current()}
          aria-hidden
          data-testid={`${testId}.scrim`}
        />
      )}
      <aside
        ref={(el) => {
          ref.current = el;
          setAside(el);
        }}
        className="fsc-drawer"
        data-mode={resolved}
        data-hug={hug ? "" : undefined}
        data-scrim={scrim ? undefined : "none"}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
      >
        <header className="fsc-drawer__head">
          <h2 id={titleId} ref={title} className="fs-sr fsc-drawer__title" tabIndex={-1}>
            {label}
          </h2>
          <p className="fsc-drawer__meta fs-t-caption">{meta}</p>
          <button
            type="button"
            className="fsc-drawer__close fs-flat"
            onClick={() => close.current()}
            data-testid={`${testId}.close`}
          >
            <Glyph name="ms:close" size={18} />
            <span>{DRAWER.close}</span>
            <kbd className="fsc-kbd">{DRAWER.closeHint}</kbd>
          </button>
        </header>
        <div className="fsc-drawer__body">{children}</div>
        {footer && (
          <footer className="fsc-drawer__foot" data-testid={`${testId}.foot`}>
            {footer}
          </footer>
        )}
      </aside>
    </>
  );

  if (stage && target) return <ChromePortal name="console.drawer">{drawer}</ChromePortal>;
  return drawer;
}
