// A screen that is not built yet, drawn the way S1 draws loading: dashed print beds at their final size
// (never a shimmer), the screen's name and job, and the seeded figures it will show, printed flat in their
// amount state with a provenance footer. The slices replace these; until then every route still renders,
// testably, in the console's own material.

import type { ReactNode } from "react";
import type { ConsoleScreenId } from "../lib/screens.js";
import { SCREEN_SLICE } from "../lib/screens.js";
import { PrintBed } from "./PrintBed.js";
import { ScreenRoot } from "./ScreenRoot.js";

export type BedLayout =
  | "stage"
  | "season"
  | "plates"
  | "split"
  | "focus"
  | "grid"
  | "column"
  | "fan"
  | "print"
  | "proof"
  | "ops"
  | "form";

export interface PlaceholderFact {
  readonly label: string;
  readonly value: string;
  /** S2.2.1's amount grammar for the value: machine figures are pencil, money in flight hollow. */
  readonly state?: "pencil" | "hollow" | "ink";
}

export interface ScreenPlaceholderProps {
  readonly id: ConsoleScreenId;
  readonly title: string;
  readonly lede: string;
  /** A stencilled mark (the season, a lot) or a run slug. */
  readonly mark?: string;
  readonly markKind?: "stencil" | "slug";
  readonly facts?: readonly PlaceholderFact[];
  /** Where the figures come from, e.g. "Seeded sample. Computed by engine v1, rate card f2d7 026d." */
  readonly provenance?: string;
  readonly beds: BedLayout;
  readonly children?: ReactNode;
}

export function ScreenPlaceholder({
  id,
  title,
  lede,
  mark,
  markKind = "stencil",
  facts = [],
  provenance,
  beds,
  children,
}: ScreenPlaceholderProps) {
  const headingId = `${id}-title`;
  return (
    <ScreenRoot id={id} state="placeholder" className={`fsc-ph fsc-ph--${beds}`} labelledBy={headingId}>
      <header className="fsc-ph__head">
        {mark && (
          <p className={markKind === "stencil" ? "fsc-ph__mark fs-t-mark" : "fsc-ph__slug fs-t-hash"}>
            {mark}
          </p>
        )}
        <h1 id={headingId} className="fsc-ph__title fs-t-title-1">
          {title}
        </h1>
        <p className="fsc-ph__lede">{lede}</p>
      </header>
      {facts.length > 0 && (
        <figure className="fsc-ph__facts">
          <dl>
            {facts.map((fact) => (
              <div key={fact.label} className="fsc-ph__fact" data-amount-state={fact.state ?? "pencil"}>
                <dt className="fs-t-caption">{fact.label}</dt>
                <dd className="fs-t-amount-l">{fact.value}</dd>
              </div>
            ))}
          </dl>
          {provenance && <figcaption className="fsc-ph__provenance fs-t-caption">{provenance}</figcaption>}
        </figure>
      )}
      {children}
      <Beds layout={beds} />
      <p className="fsc-ph__note fs-t-caption" data-slice={SCREEN_SLICE[id]}>
        This screen prints here once it is built. The dashed beds are its layout at final size.
      </p>
    </ScreenRoot>
  );
}

/** The replay's twelve photos (register §2: A–L), as the contact sheet labels them. */
const REPLAY_PHOTOS = "ABCDEFGHIJKL".split("").map((id) => `Photo ${id}`);

function Beds({ layout }: { readonly layout: BedLayout }) {
  switch (layout) {
    case "stage":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <div className="fsc-beds__sheet">
            <PrintBed shape="photo" labels={REPLAY_PHOTOS} />
          </div>
          <div className="fsc-beds__plates">
            <PrintBed shape="plate" height={168} labels={["Rate card, bolted"]} />
            <PrintBed shape="plate" height={212} labels={["Invoice"]} />
          </div>
        </div>
      );
    case "season":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <div className="fsc-beds__strip">
            <PrintBed shape="line" count={6} />
          </div>
          <div className="fsc-beds__plates fsc-beds__plates--wide">
            <PrintBed shape="plate" height={212} labels={["Pools"]} />
            <PrintBed shape="plate" height={212} labels={["Invoice"]} />
            <PrintBed shape="plate" height={212} labels={["Eval"]} />
          </div>
        </div>
      );
    case "plates":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="photo" className="fsc-bed--page" />
          <div className="fsc-beds__rules">
            <PrintBed shape="line" count={7} />
            <PrintBed shape="plate" height={88} />
          </div>
        </div>
      );
    case "split":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="photo" className="fsc-bed--bench" />
          <div className="fsc-beds__rules">
            <PrintBed shape="row" count={8} />
          </div>
        </div>
      );
    case "focus":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="photo" className="fsc-bed--crop" />
          <PrintBed shape="block" height={56} />
          <PrintBed shape="slab" />
        </div>
      );
    case "grid":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <div className="fsc-beds__header">
            <PrintBed shape="seal" width={120} height={120} />
            <div className="fsc-beds__rules">
              <PrintBed shape="line" count={3} />
            </div>
          </div>
          <div className="fsc-beds__grid">
            <PrintBed shape="row" count={10} />
          </div>
        </div>
      );
    case "column":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="block" height={72} />
          <PrintBed shape="line" count={3} />
          <div className="fsc-beds__keys">
            <PrintBed shape="block" height={64} />
            <PrintBed shape="block" height={64} />
          </div>
          <PrintBed shape="slab" />
        </div>
      );
    case "fan":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="block" className="fsc-bed--fan" />
          <div className="fsc-beds__lanes">
            <PrintBed shape="block" height={180} count={3} />
          </div>
        </div>
      );
    case "print":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="block" className="fsc-bed--receipt" />
        </div>
      );
    case "proof":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="plate" height={120} count={6} />
        </div>
      );
    case "ops":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <div className="fsc-beds__tiles">
            <PrintBed shape="plate" height={132} count={4} />
          </div>
          <PrintBed shape="row" count={6} />
        </div>
      );
    case "form":
      return (
        <div className="fsc-beds" data-layout={layout} aria-hidden>
          <PrintBed shape="block" height={44} count={2} />
        </div>
      );
  }
}
