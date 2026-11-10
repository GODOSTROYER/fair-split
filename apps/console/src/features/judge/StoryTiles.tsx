// W-JG-01's story, under the invoice and the first press (ADR-0016; UI gate rounds 2 and 3, number first):
// five steps, Read, Check, Sign, Pay and Prove, each a small coloured dot and its verb over one figure counted
// from the seed (never typed): 48 slips, 3 holds, 2 keys, the pay split, 6 checks. The dots are the stage's own
// marks: graphite for the machine, marigold for a hold, ballpoint for a person's key, the dashed steel ring for the
// simulated PayPal sandbox, ink for Proof. No bubbles, no coloured bars, no sentences.
//
// Round 3 (one truth for counts): the pay split says what it is. Until the run settles it is the plan, in grey,
// "8 PayPal · 56 cash planned"; once it settles it is what happened, "7 PayPal · 57 cash" (Rhea's line moved to
// cash). The legend row that followed the steps is gone: the marks' words are their tooltips, and What's real
// holds the legend. Nothing here claims a live Claude reading: on this stage the reading is the labelled seed
// stand-in.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import type { ReactNode } from "react";
import type { RunView } from "../../data/run-view.js";
import { payCell } from "../../lib/display.js";
import { PLATES } from "../proof/verify.js";
import { replayPhotos } from "../reading/model.js";
import { isCardHold } from "../split/model.js";

export type StoryRole = "read" | "check" | "sign" | "pay" | "prove";

export interface StoryTile {
  readonly role: StoryRole;
  readonly step: string;
  /** The step's figure: the number, then its unit. */
  readonly figure: ReactNode;
  /** The same in words, for the step's accessible name and tests. */
  readonly text: string;
  /** The pay split before the run settles is a plan (grey); everything else is a fact. */
  readonly phase?: "planned" | "settled";
}

/** The five steps' figures, from the season's own snapshot, the run (for the pay split) and Proof's plates. */
export function storyTiles(snapshot: SeasonSnapshot, view?: RunView): readonly StoryTile[] {
  // The slips on the desk: the replay photos' own serials (the reading room's "of 48 slips read").
  const slips = replayPhotos(snapshot).reduce((n, photo) => n + photo.slips.length, 0);
  // The holds a person decides (H1 to H3), not the by-hand field or the season's dial.
  const holds = snapshot.holds.filter(isCardHold).length;
  const signers = snapshot.officers.filter((o) => o.role === "TREASURER" || o.role === "CHAIR").length;
  const pay = payCell(snapshot, view);
  const checks = PLATES.length;
  const big = (n: number) => <b className="fsc-tile__no">{n}</b>;
  return [
    { role: "read", step: "Read", figure: <>{big(slips)} slips</>, text: `${slips} slips` },
    { role: "check", step: "Check", figure: <>{big(holds)} holds</>, text: `${holds} holds` },
    { role: "sign", step: "Sign", figure: <>{big(signers)} keys</>, text: `${signers} keys` },
    {
      role: "pay",
      step: "Pay",
      figure: (
        <>
          {big(pay.paypal)} PayPal <span className="fsc-tile__sep">·</span> {big(pay.cash)} cash
          {pay.phase === "planned" && <span className="fs-sr"> planned</span>}
        </>
      ),
      text:
        pay.phase === "planned"
          ? `${pay.paypal} PayPal · ${pay.cash} cash planned`
          : `${pay.paypal} PayPal · ${pay.cash} cash`,
      phase: pay.phase,
    },
    { role: "prove", step: "Prove", figure: <>{big(checks)} checks</>, text: `${checks} checks` },
  ];
}

export function StoryTiles({
  snapshot,
  view,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly view?: RunView | undefined;
}) {
  const tiles = storyTiles(snapshot, view);
  return (
    <ol className="fsc-tiles" data-testid="story-tiles" aria-label="How a season runs, in five steps">
      {tiles.map((tile, i) => (
        <li
          key={tile.role}
          className="fsc-tile"
          data-role={tile.role}
          data-phase={tile.phase}
          data-testid={`story-tiles.${tile.role}`}
        >
          <span className="fsc-tile__step fs-t-label">
            <span className="fsc-tile__dot" aria-hidden />
            <span className="fs-sr">{i + 1} </span>
            {tile.step}
            {tile.phase === "planned" && (
              <span className="fsc-tile__planned fs-t-caption" aria-hidden>
                planned
              </span>
            )}
          </span>
          <span className="fsc-tile__figure">{tile.figure}</span>
        </li>
      ))}
    </ol>
  );
}
