// W-JG-01's story, under the invoice and the first slab (ADR-0016, decision.md §3, grafts from C and B):
// - the five numbered story tiles, Read, Check, Sign, Pay and Prove, which are also the colour key: each has a
//   solid bubble and a 3 px top bar in its role's colour (graphite pencil, marigold, ballpoint, jade, ink) and one
//   real figure, counted from the seed (never typed); the six checks are Proof's own plates;
// - the honest "What's real" strip: real code, the simulated PayPal sandbox, synthetic samples.
// Nothing here claims a live Claude reading: on this stage the reading is the labelled seed stand-in.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph, type GlyphName } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { PLATES } from "../proof/verify.js";
import { replayPhotos } from "../reading/model.js";
import { isCardHold } from "../split/model.js";

export type StoryRole = "read" | "check" | "sign" | "pay" | "prove";

export interface StoryTile {
  readonly role: StoryRole;
  readonly step: string;
  readonly glyph: GlyphName;
  /** The tile's figure, its numbers in bold. */
  readonly figure: ReactNode;
  /** The same in words, for the tile's accessible name and tests. */
  readonly text: string;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** The five tiles' figures, from the season's own snapshot and Proof's plates. */
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
  return [
    {
      role: "read",
      step: "Read",
      glyph: "triplicate-slip",
      figure: (
        <>
          Claude is built to read <b>{slips}</b> slips
        </>
      ),
      text: `Claude is built to read ${slips} slips`,
    },
    {
      role: "check",
      step: "Check",
      glyph: "hanging-scale",
      figure: (
        <>
          <b>{holds}</b> holds stop mistakes
        </>
      ),
      text: `${holds} holds stop mistakes`,
    },
    {
      role: "sign",
      step: "Sign",
      glyph: "thumbmark",
      figure: (
        <>
          <b>{signers}</b> officers, <b>1</b> hash
        </>
      ),
      text: `${signers} officers, 1 hash`,
    },
    {
      role: "pay",
      step: "Pay",
      glyph: "rail",
      figure: (
        <>
          <b>{paypal}</b> PayPal, <b>{cash}</b> cash
        </>
      ),
      text: `${paypal} PayPal, ${cash} cash`,
    },
    {
      role: "prove",
      step: "Prove",
      glyph: "seal",
      figure: (
        <>
          Brand re-checks <b>{checks}</b>
        </>
      ),
      text: `Brand re-checks ${checks}`,
    },
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
          <span className="fsc-tile__bubble" aria-hidden>
            <Glyph name={tile.glyph} size={16} />
          </span>
          <span className="fsc-tile__body">
            <span className="fsc-tile__step fs-t-label">
              <span className="fsc-tile__no">{i + 1}</span> {tile.step}
            </span>
            <span className="fsc-tile__figure fs-t-caption">{tile.figure}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "What's real", in three honest parts (decision.md §3, graft 6 from B). */
export function whatsReal(members: number): readonly { kind: string; title: string; body: string }[] {
  return [
    {
      kind: "real",
      title: "Real code, running now",
      body: `The split engine, the holds, both signatures and Proof's ${word(PLATES.length)} checks.`,
    },
    {
      kind: "simulated",
      title: "Simulated PayPal sandbox",
      body: "Every PayPal step, labelled wherever it shows.",
    },
    {
      kind: "synthetic",
      title: "Synthetic samples",
      body: `The co-op, its ${members} people and their slips. No real money moves.`,
    },
  ];
}

export function WhatsRealStrip({ members }: { readonly members: number }) {
  return (
    <section className="fsc-real" aria-label="What's real" data-testid="W-JG-01.realStrip">
      <p className="fsc-real__title fs-t-label">
        <Glyph name="ms:visibility" size={16} />
        What's real
      </p>
      <ul className="fsc-real__list">
        {whatsReal(members).map((part) => (
          <li key={part.kind} className="fsc-real__part" data-kind={part.kind}>
            <span className="fsc-real__mark" aria-hidden />
            <span className="fsc-real__words">
              <span className="fsc-real__name fs-t-label">{part.title}</span>
              <span className="fsc-real__body fs-t-caption">{part.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
