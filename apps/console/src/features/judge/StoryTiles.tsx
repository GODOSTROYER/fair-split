// W-JG-01's story, under the invoice and the first press (ADR-0016; UI gate round 2, number first):
// - five steps, Read, Check, Sign, Pay and Prove, each a small coloured dot and its verb over one figure counted
//   from the seed (never typed): 48 slips, 3 holds, 2 keys, 7 PayPal · 57 cash, 6 checks. The dots are the
//   stage's own marks: graphite for the machine, marigold for a hold, ballpoint for a person's key, the dashed
//   steel ring for the simulated PayPal sandbox, ink for Proof. No bubbles, no coloured bars, no sentences;
// - the honesty row, the legend for the stage's marks: Real code, Simulated PayPal sandbox, Synthetic sample. The
//   explanations live in What's real, opened from the top bar.
// Nothing here claims a live Claude reading: on this stage the reading is the labelled seed stand-in.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import type { ReactNode } from "react";
import { railTag } from "../../chrome/copy.js";
import type { PaypalRail } from "../../lib/env.js";
import { PLATES } from "../proof/verify.js";
import { replayPhotos } from "../reading/model.js";
import { FIRST_VIEW_COPY } from "../season/copy.js";
import { isCardHold } from "../split/model.js";

export type StoryRole = "read" | "check" | "sign" | "pay" | "prove";

export interface StoryTile {
  readonly role: StoryRole;
  readonly step: string;
  /** The step's figure: the number, then its unit. */
  readonly figure: ReactNode;
  /** The same in words, for the step's accessible name and tests. */
  readonly text: string;
}

/** The five steps' figures, from the season's own snapshot and Proof's plates. */
export function storyTiles(snapshot: SeasonSnapshot): readonly StoryTile[] {
  const f = snapshot.figures;
  // The slips on the desk: the replay photos' own serials (the reading room's "of 48 slips read").
  const slips = replayPhotos(snapshot).reduce((n, photo) => n + photo.slips.length, 0);
  // The holds a person decides (H1 to H3), not the by-hand field or the season's dial.
  const holds = snapshot.holds.filter(isCardHold).length;
  const signers = snapshot.officers.filter((o) => o.role === "TREASURER" || o.role === "CHAIR").length;
  const paypal = f.endPaidMembers;
  const cash = f.endCashMembers;
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
          {big(paypal)} PayPal <span className="fsc-tile__sep">·</span> {big(cash)} cash
        </>
      ),
      text: `${paypal} PayPal · ${cash} cash`,
    },
    { role: "prove", step: "Prove", figure: <>{big(checks)} checks</>, text: `${checks} checks` },
  ];
}

export function StoryTiles({ snapshot }: { readonly snapshot: SeasonSnapshot }) {
  const tiles = storyTiles(snapshot);
  return (
    <ol className="fsc-tiles" data-testid="story-tiles" aria-label="How a season runs, in five steps">
      {tiles.map((tile, i) => (
        <li
          key={tile.role}
          className="fsc-tile"
          data-role={tile.role}
          data-testid={`story-tiles.${tile.role}`}
        >
          <span className="fsc-tile__step fs-t-label">
            <span className="fsc-tile__dot" aria-hidden />
            <span className="fs-sr">{i + 1} </span>
            {tile.step}
          </span>
          <span className="fsc-tile__figure">{tile.figure}</span>
        </li>
      ))}
    </ol>
  );
}

/** The honesty row's three marks (decision.md §3, graft 6 from B; UI gate round 2: tags, never sentences). */
export function whatsReal(rail: PaypalRail = "simulator"): readonly { kind: string; title: string }[] {
  return [
    { kind: "real", title: FIRST_VIEW_COPY.realCode },
    { kind: "simulated", title: railTag(rail) },
    { kind: "synthetic", title: FIRST_VIEW_COPY.syntheticSample },
  ];
}

/** The legend for the stage's honesty marks; the details live in What's real (the top bar). */
export function WhatsRealStrip({ rail = "simulator" }: { readonly rail?: PaypalRail }) {
  return (
    <ul className="fsc-real" aria-label="What's real" data-testid="W-JG-01.realStrip">
      {whatsReal(rail).map((part) => (
        <li key={part.kind} className="fsc-real__part fs-t-micro" data-kind={part.kind}>
          <span className="fsc-real__mark" aria-hidden />
          {part.title}
        </li>
      ))}
    </ul>
  );
}
