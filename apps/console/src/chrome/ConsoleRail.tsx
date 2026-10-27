// The console's flat 220 px rail (S1.7): the lockup, six places with WS-DS's glyphs (filled when current), the
// person the judge acts as, Shortcuts, and the season's stencilled mark, as on the jute sacks. Below 1280 px
// it folds to glyphs; each label is still announced, and shows beside its glyph on hover or focus.

import { Glyph, useT } from "@fairsplit/ui-web";
import { useRouterState } from "@tanstack/react-router";
import { useShortcuts } from "../lib/shortcuts.js";
import { AppLink } from "./AppLink.js";
import { STAGE } from "./copy.js";
import { activeRailItem, type RailItem } from "./rail-items.js";
import { Wordmark } from "./Wordmark.js";

export interface ConsoleRailProps {
  readonly items: readonly RailItem[];
  readonly collapsed: boolean;
  /** The stencilled season mark: "2026-A". */
  readonly seasonMark: string;
}

export function ConsoleRail({ items, collapsed, seasonMark }: ConsoleRailProps) {
  const t = useT();
  const shortcuts = useShortcuts();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = activeRailItem(pathname);
  return (
    <nav
      className="fsc-rail"
      aria-label="Console"
      data-collapsed={collapsed ? "" : undefined}
      data-testid="W-JG-01.rail"
    >
      {!collapsed && <Wordmark />}
      <ul className="fsc-rail__list">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id}>
              <AppLink
                href={item.href}
                className="fsc-rail__item"
                aria-current={current ? "page" : undefined}
                aria-label={collapsed ? t(item.label) : undefined}
                data-testid={`W-JG-01.rail.${item.id}`}
              >
                <Glyph name={current ? item.activeGlyph : item.glyph} size={18} />
                <span className="fsc-rail__label">{t(item.label)}</span>
              </AppLink>
            </li>
          );
        })}
      </ul>
      <div className="fsc-rail__foot">
        {!collapsed && <p className="fsc-rail__acting fs-t-caption">{t("W-JG-01.actingAs")}</p>}
        <button
          type="button"
          className="fsc-rail__item fsc-rail__shortcuts"
          onClick={() => shortcuts.setSheetOpen(true)}
          aria-label={collapsed ? STAGE.shortcuts : undefined}
          data-testid="W-JG-01.rail.shortcuts"
        >
          <Glyph name="ms:keyboard" size={18} />
          <span className="fsc-rail__label">{STAGE.shortcuts}</span>
          {!collapsed && <kbd className="fsc-kbd">?</kbd>}
        </button>
        <p className="fsc-rail__mark" aria-hidden>
          {seasonMark}
        </p>
      </div>
    </nav>
  );
}
