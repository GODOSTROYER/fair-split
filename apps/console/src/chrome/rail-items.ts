// The console's six places (S1.7: Season, Rate card, Reading room, Split review, Approve, Run), with the
// glyphs WS-DS drew for them. Season places use the season label; run places use the run on the stage.

import { webRoutes } from "@fairsplit/contracts";
import type { MessageKey } from "@fairsplit/i18n";
import type { GlyphName } from "@fairsplit/ui-web";
import type { ConsoleScreenId } from "../lib/screens.js";

export interface RailItem {
  readonly id: "season" | "rate-card" | "reading" | "split" | "approve" | "run";
  readonly label: MessageKey;
  readonly glyph: GlyphName;
  readonly activeGlyph: GlyphName;
  readonly href: string;
  readonly screens: readonly ConsoleScreenId[];
}

export function railItems(season: string, runSlug: string | null): RailItem[] {
  const run = runSlug ?? "";
  return [
    {
      id: "season",
      label: "console.nav.season",
      glyph: "sack",
      activeGlyph: "sack-fill",
      href: webRoutes.season(season),
      screens: ["W-TR-01", "W-JG-01"],
    },
    {
      id: "rate-card",
      label: "console.nav.rateCard",
      glyph: "bolt",
      activeGlyph: "bolt-fill",
      href: webRoutes.rateCard(season),
      screens: ["W-TR-02"],
    },
    {
      id: "reading",
      label: "console.nav.reading",
      glyph: "triplicate-slip",
      activeGlyph: "triplicate-slip-fill",
      href: webRoutes.reading(season),
      screens: ["W-TR-03", "W-TR-04"],
    },
    {
      id: "split",
      label: "console.nav.split",
      glyph: "hanging-scale",
      activeGlyph: "hanging-scale-fill",
      href: webRoutes.split(run),
      screens: ["W-TR-05", "W-TR-06", "W-TR-09"],
    },
    {
      id: "approve",
      label: "console.nav.approve",
      glyph: "seal",
      activeGlyph: "seal-fill",
      href: webRoutes.approve(run),
      screens: ["W-TR-07"],
    },
    {
      id: "run",
      label: "console.nav.run",
      glyph: "rail",
      activeGlyph: "rail-fill",
      href: webRoutes.fanout(run),
      screens: ["W-TR-08"],
    },
  ];
}

/** Where the run stands with a place: done, the place the next step is in, or still ahead. */
export type PlaceState = "done" | "next" | "later";

/**
 * Each place's state from the run pill's step: places before the step's place are done, its own is next, the
 * rest are ahead. The rate card is ratified before the first slip, so it is done whenever one is in force.
 * Once the run is settled (the step is Proof) every place is done.
 */
export function placeStates(
  items: readonly RailItem[],
  nextScreen: ConsoleScreenId | null,
  ratified: boolean,
): Partial<Record<RailItem["id"], PlaceState>> {
  const out: Partial<Record<RailItem["id"], PlaceState>> = {};
  if (nextScreen === null) return out;
  const at = items.findIndex((item) => item.screens.includes(nextScreen));
  items.forEach((item, i) => {
    if (item.id === "rate-card" && ratified && i !== at) out[item.id] = "done";
    else if (at < 0 || i < at) out[item.id] = "done";
    else out[item.id] = i === at ? "next" : "later";
  });
  return out;
}

/** Which place a pathname belongs to (the Judge stage's first view is the Season). */
export function activeRailItem(pathname: string): RailItem["id"] | null {
  if (pathname === "/judge" || /^\/season\/[^/]+\/?$/.test(pathname)) return "season";
  if (/^\/season\/[^/]+\/rate-card/.test(pathname)) return "rate-card";
  if (/^\/season\/[^/]+\/(reading|by-hand)/.test(pathname)) return "reading";
  if (/^\/runs\/[^/]+\/(split|members)/.test(pathname)) return "split";
  if (/^\/runs\/[^/]+\/approve/.test(pathname)) return "approve";
  if (/^\/runs\/[^/]+\/fanout/.test(pathname)) return "run";
  return null;
}
