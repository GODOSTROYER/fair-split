// The console's one drawer frame (S1.6 "Drawers", design §2.4): W-TR-06 (the hold drawer) and W-TR-09 (the
// member line) render inside it. It portals beside the screen, so it never scrolls with the grid, and it
// follows the stage's width: it pushes the screen aside below 1600 px (full width below 1280) and overlays
// it at 560 px from 1600 over the scrim. Plate-2 with a 1 px top highlight; Esc and Close end it. Outside
// the stage (component tests) it renders in place.

import { Glyph } from "@fairsplit/ui-web";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { restoreFocus, useFocusAfterRemoval } from "../lib/focus.js";
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
}

export function StageDrawer({ label, meta, onClose, children, testId, mode }: StageDrawerProps) {
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

  // Focus lands on the drawer's title when it opens (its name is read out; no ring frames the whole drawer),
  // unless something inside already took it (a pre-focused slab). Closing hands focus back to what opened it
  // (a grid row, a link), or to the screen when that is gone (WCAG 2.4.3).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement && active !== document.body && !el.contains(active) ? active : null;
    if (!el.contains(document.activeElement)) (title.current ?? el).focus({ preventScroll: true });
    return () => restoreFocus(opener, () => document.getElementById("fsc-main"));
  }, []);

  // The same drawer moving to another subject ("Next: hold H2") reads its new name out.
  const named = useRef(label);
  useEffect(() => {
    if (named.current === label) return;
    named.current = label;
    const el = ref.current;
    if (el && (el.contains(document.activeElement) || document.activeElement === document.body)) {
      (title.current ?? el).focus({ preventScroll: true });
    }
  }, [label]);

  // A control the answer removes ("Count it once") leaves focus on the drawer's result line, or its title.
  const [aside, setAside] = useState<HTMLElement | null>(null);
  useFocusAfterRemoval(aside, () => aside?.querySelector<HTMLElement>("[data-focus-after]") ?? title.current);

  // Covering the screen (full width below 1280 px, over the scrim from 1600 px), the drawer takes the keyboard:
  // the screen under it is inert, so Tab never lands on a control the drawer hides (S1.12, WCAG 2.4.11). Pushing
  // it aside (1280-1599 px), the screen stays live beside it.
  const covers = Boolean(stage && target) && (resolved === "push-full" || resolved === "overlay");
  useEffect(() => {
    if (!covers) return;
    const main = document.getElementById("fsc-main");
    if (!main) return;
    main.setAttribute("inert", "");
    return () => main.removeAttribute("inert");
  }, [covers]);

  const drawer = (
    <>
      {resolved === "overlay" && (
        <div
          className="fsc-drawer-scrim"
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
      </aside>
    </>
  );

  if (stage && target) return <ChromePortal name="console.drawer">{drawer}</ChromePortal>;
  return drawer;
}
