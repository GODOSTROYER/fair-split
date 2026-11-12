// The console's flat 220 px rail (S1.7; UI gate round 3): six places with WS-DS's glyphs (filled when current), and
// at its foot the person the judge acts as ("AS Analyn · Treasurer", the catalog's whole sentence as its name) and
// the "?" key for Shortcuts. The lockup moved to the top bar (it leads there at every width); the places keep their
// labels from 1280 px up, the 1,470 laptop included. Each place says where the run stands with it, in the run pill's own marks: an ink tick once
// it is done, and on the place the next step is in, the pill's mark for who moves next (canary when a person
// decides, pencil while the machine reads, an open ring while PayPal confirms). The current
// place is marked by a 3 px ink rule, not a filled plate. Below 1280 px it folds to glyphs; each label is still
// announced, and shows beside its glyph on hover or focus.

import { Glyph, useT } from "@fairsplit/ui-web";
import { useRouterState } from "@tanstack/react-router";
import { useShortcuts } from "../lib/shortcuts.js";
import { AppLink } from "./AppLink.js";
import { STAGE } from "./copy.js";
import type { StepActor } from "./next-step.js";
import { activeRailItem, type PlaceState, type RailItem } from "./rail-items.js";

/** The person the judge acts as, short: their initials, first name and role. */
export interface RailActor {
  readonly initials: string;
  readonly first: string;
  readonly role: string;
}

export interface ConsoleRailProps {
  readonly items: readonly RailItem[];
  readonly collapsed: boolean;
  /** The season mark: "2026-A" (no longer printed in the rail; kept for its callers). */
  readonly seasonMark?: string;
  /** The person the judge acts as. */
  readonly actor?: RailActor;
  /** Where the run stands with each place: done, next, or still ahead. */
  readonly states?: Readonly<Partial<Record<RailItem["id"], PlaceState>>>;
  /** Who moves the run next (the pill's actor): the next place's mark follows it. */
  readonly nextActor?: StepActor;
}

/** What the next place's mark says, beside "next step", for whoever moves the run. */
const NEXT_ACTOR_WORDS: Readonly<Record<StepActor, string>> = {
  person: "yours",
  machine: "the machine's",
  paypal: "PayPal's",
  done: "done",
};

const PLACE_WORDS: Readonly<Record<PlaceState, string>> = {
  done: "done",
  next: "next step",
  later: "later",
};

export function ConsoleRail({ items, collapsed, actor, states, nextActor = "person" }: ConsoleRailProps) {
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
      <ul className="fsc-rail__list">
        {items.map((item) => {
          const current = item.id === active;
          const place = states?.[item.id];
          const words =
            place === "next"
              ? `${PLACE_WORDS.next}, ${NEXT_ACTOR_WORDS[nextActor]}`
              : place
                ? PLACE_WORDS[place]
                : "";
          return (
            <li key={item.id}>
              <AppLink
                href={item.href}
                className="fsc-rail__item"
                aria-current={current ? "page" : undefined}
                aria-label={collapsed ? (place ? `${t(item.label)}, ${words}` : t(item.label)) : undefined}
                data-place={place}
                data-testid={`W-JG-01.rail.${item.id}`}
              >
                <Glyph name={current ? item.activeGlyph : item.glyph} size={18} />
                <span className="fsc-rail__label">{t(item.label)}</span>
                {place && (
                  <span
                    className="fsc-rail__place"
                    data-place={place}
                    data-testid={`W-JG-01.rail.${item.id}.place`}
                  >
                    {place === "done" ? (
                      <Glyph name="ms:check" size={14} />
                    ) : place === "next" ? (
                      <span className="fsc-rail__square" data-actor={nextActor} />
                    ) : null}
                    <span className="fs-sr">, {words}</span>
                  </span>
                )}
              </AppLink>
            </li>
          );
        })}
      </ul>
      <div className="fsc-rail__foot">
        {!collapsed && (
          <p className="fsc-rail__acting fs-t-label" title={t("W-JG-01.actingAs")}>
            {actor ? (
              <>
                <span className="fs-stamp" aria-hidden>
                  <span className="fs-t-stamp">{actor.initials}</span>
                </span>
                <span className="fs-sr">{t("W-JG-01.actingAs")}</span>
                <span aria-hidden>{STAGE.actingShort(actor.first, actor.role)}</span>
              </>
            ) : (
              t("W-JG-01.actingAs")
            )}
          </p>
        )}
        <button
          type="button"
          className="fsc-rail__item fsc-rail__shortcuts"
          onClick={() => shortcuts.setSheetOpen(true)}
          aria-label={STAGE.shortcuts}
          title={STAGE.shortcuts}
          data-testid="W-JG-01.rail.shortcuts"
        >
          <Glyph name="ms:keyboard" size={18} />
          <span className="fsc-rail__label" aria-hidden>
            {STAGE.shortcuts}
          </span>
          {!collapsed && <kbd className="fsc-kbd">?</kbd>}
        </button>
      </div>
    </nav>
  );
}
