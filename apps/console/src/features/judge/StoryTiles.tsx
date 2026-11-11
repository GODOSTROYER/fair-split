// W-JG-01's pipeline (ADR-0016; UI gate rounds 2 to 5, number first): five steps, Read, Check, Sign, Pay and Prove,
// on one track, each a state dot and its verb over one figure counted from the seed (never typed): 48 slips, 3 holds,
// 2 keys, the pay split, 6 checks.
//
// Round 5 (one marker vocabulary): the dots are StateDots and say only state, never who acts: pending hollow, done
// ink, held amber (a person must decide: Read while slip 0462 waits for a person, Check while holds are open), paid
// jade (Pay once the simulated PayPal confirmed and the payouts are not a replay). No indigo on the strip. Every
// count is ink; its unit is the label role in ink-2. The strip is flat (a rule above it, no card).
//
// Round 3 (one truth for counts): the pay split says what it is. Until the run settles it is the plan, "8 PayPal ·
// 56 cash planned"; once it settles it is what happened, "7 PayPal · 57 cash" (Rhea's line moved to cash). Nothing
// here claims a live Claude reading: on this stage the reading is the labelled seed stand-in.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { StateDot, type StateDotKind } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { payoutReplayed } from "../../data/payout-replay.js";
import { atLeast, byHandHolds, openHolds, type RunView } from "../../data/run-view.js";
import { payCell } from "../../lib/display.js";
import { PLATES } from "../proof/verify.js";
import { replayPhotos } from "../reading/model.js";
import { isCardHold } from "../split/model.js";

export type StoryRole = "read" | "check" | "sign" | "pay" | "prove";

/** A step's state, in the one marker vocabulary's colours (round 5). */
export type StoryState = "pending" | "done" | "held" | "paid";

export interface StoryTile {
  readonly role: StoryRole;
  readonly step: string;
  /** The step's figure: the number, then its unit. */
  readonly figure: ReactNode;
  /** The same in words, for the step's accessible name and tests. */
  readonly text: string;
  /** The pay split before the run settles is a plan; after it, what happened. */
  readonly phase?: "planned" | "settled";
  /** Where the step is: its dot's colour, and its word for assistive technology. */
  readonly state: StoryState;
}

/** What the run has reached beyond its own view: Proof's six checks run in the judge's browser. */
export interface StoryProgress {
  readonly proofChecked?: boolean;
}

const STATE_WORD: Readonly<Record<StoryState, string>> = {
  pending: "not yet",
  done: "done",
  held: "waiting for a person",
  paid: "confirmed by the simulated PayPal",
};

const DOT: Readonly<Record<StoryState, StateDotKind>> = {
  pending: "pending",
  done: "done",
  held: "held",
  paid: "paid",
};

/** Each step's state from the run (round 5): only what has happened lights, and only in its state's colour. */
export function storyStates(
  view: RunView | undefined,
  progress: StoryProgress = {},
): Record<StoryRole, StoryState> {
  const read = view !== undefined && atLeast(view, "COMPUTED");
  const open = view ? openHolds(view) : [];
  const byHand = view ? byHandHolds(view).some((hold) => open.includes(hold)) : false;
  const holds = open.some((hold) => hold.kind !== "LOW_CONFIDENCE");
  const settled = view !== undefined && atLeast(view, "SETTLED");
  return {
    read: !read ? "pending" : byHand ? "held" : "done",
    check: !read ? "pending" : holds || byHand ? "held" : "done",
    sign: view !== undefined && atLeast(view, "APPROVED") ? "done" : "pending",
    // Jade only for money the simulated PayPal confirmed; a replayed payout status is a fact, never paid.
    pay: !settled ? "pending" : payoutReplayed(view) ? "done" : "paid",
    prove: progress.proofChecked ? "done" : "pending",
  };
}

/** The five steps' figures, from the season's own snapshot, the run (for the pay split) and Proof's plates. */
export function storyTiles(
  snapshot: SeasonSnapshot,
  view?: RunView,
  progress: StoryProgress = {},
): readonly StoryTile[] {
  // The slips on the desk: the replay photos' own serials (the reading room's "of 48 slips read").
  const slips = replayPhotos(snapshot).reduce((n, photo) => n + photo.slips.length, 0);
  // The holds a person decides (H1 to H3), not the by-hand field or the season's dial.
  const holds = snapshot.holds.filter(isCardHold).length;
  const signers = snapshot.officers.filter((o) => o.role === "TREASURER" || o.role === "CHAIR").length;
  const pay = payCell(snapshot, view);
  const checks = PLATES.length;
  const states = storyStates(view, progress);
  const big = (n: number) => <b className="fsc-tile__no">{n}</b>;
  const unit = (words: string) => <span className="fsc-tile__unit">{words}</span>;
  return [
    {
      role: "read",
      step: "Read",
      figure: (
        <>
          {big(slips)} {unit("slips")}
        </>
      ),
      text: `${slips} slips`,
      state: states.read,
    },
    {
      role: "check",
      step: "Check",
      figure: (
        <>
          {big(holds)} {unit("holds")}
        </>
      ),
      text: `${holds} holds`,
      state: states.check,
    },
    {
      role: "sign",
      step: "Sign",
      figure: (
        <>
          {big(signers)} {unit("keys")}
        </>
      ),
      text: `${signers} keys`,
      state: states.sign,
    },
    {
      role: "pay",
      step: "Pay",
      figure: (
        <>
          {big(pay.paypal)} {unit("PayPal")} <span className="fsc-tile__sep">·</span> {big(pay.cash)}{" "}
          {unit("cash")}
          {pay.phase === "planned" && <span className="fs-sr"> planned</span>}
        </>
      ),
      text:
        pay.phase === "planned"
          ? `${pay.paypal} PayPal · ${pay.cash} cash planned`
          : `${pay.paypal} PayPal · ${pay.cash} cash`,
      phase: pay.phase,
      state: states.pay,
    },
    {
      role: "prove",
      step: "Prove",
      figure: (
        <>
          {big(checks)} {unit("checks")}
        </>
      ),
      text: `${checks} checks`,
      state: states.prove,
    },
  ];
}

export function StoryTiles({
  snapshot,
  view,
  progress,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly view?: RunView | undefined;
  readonly progress?: StoryProgress;
}) {
  const tiles = storyTiles(snapshot, view, progress);
  return (
    <ol className="fsc-tiles" data-testid="story-tiles" aria-label="How a season runs, in five steps">
      {tiles.map((tile, i) => (
        <li
          key={tile.role}
          className="fsc-tile"
          data-role={tile.role}
          data-phase={tile.phase}
          data-state={tile.state}
          data-testid={`story-tiles.${tile.role}`}
        >
          <span className="fsc-tile__step fs-t-label">
            <span className="fsc-tile__node">
              <StateDot kind={DOT[tile.state]} />
            </span>
            <span className="fs-sr">{i + 1} </span>
            {tile.step}
            <span className="fs-sr">{`, ${STATE_WORD[tile.state]}: `}</span>
          </span>
          <span className="fsc-tile__figure">
            {tile.figure}
            {tile.phase === "planned" && (
              <span className="fsc-tile__planned fs-t-caption" aria-hidden>
                planned
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
