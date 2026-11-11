// The money bar (unslop spec §1.9) on Approve: one stacked bar, each segment as wide as its money, and a legend row per
// segment (its key, the name, the count, a note, the amount). Colour is only meaning (UI gate rounds 3 and 5): the
// PayPal batch is a steel dashed outline on the steel face while it is planned (dashed means simulated: the batch the
// simulated PayPal is asked to move), and turns jade only once that PayPal confirmed it; marigold waits on a person;
// hatch is cash. The legend's key is the vocabulary's one square, ui-web's Swatch. The bar is decoration for the
// legend, which carries every figure in words. (Round 5: Run no longer draws a bar; its fan carries every amount.)

import { MoneyFigure, Swatch, type SwatchKind } from "@fairsplit/ui-web";
import type { CSSProperties } from "react";
import "./money-bar.css";

export type MoneyTone = "planned" | "signed" | "confirmed" | "held" | "cash";

/** Each tone's legend key. */
const SWATCH: Readonly<Record<MoneyTone, SwatchKind>> = {
  planned: "planned",
  // Signed by both keys, not yet confirmed: the signers' indigo (the vocabulary's square for a person's decision).
  signed: "held",
  confirmed: "paid",
  held: "held",
  cash: "cash",
};

export interface MoneySegment {
  readonly key: string;
  readonly tone: MoneyTone;
  readonly cents: number;
  readonly label: string;
  /** How many members, set as a micro figure beside the name. */
  readonly count?: number;
  /** A micro note after the count ("6 Nov"). */
  readonly note?: string;
  /** "US$368.39" */
  readonly amount: string;
}

export interface MoneyBarProps {
  readonly segments: readonly MoneySegment[];
  readonly label: string;
  readonly testId?: string;
  readonly className?: string;
}

export function MoneyBar({ segments, label, testId, className }: MoneyBarProps) {
  const shown = segments.filter((s) => s.cents > 0 || s.count);
  return (
    <figure className={["fsr-money", className].filter(Boolean).join(" ")} data-testid={testId}>
      <figcaption className="fs-sr">{label}</figcaption>
      <div className="fsr-money__bar" aria-hidden>
        {shown
          .filter((s) => s.cents > 0)
          .map((s) => (
            <span
              key={s.key}
              className="fsr-money__seg"
              data-tone={s.tone}
              style={{ "--fsr-grow": String(s.cents) } as CSSProperties}
            />
          ))}
      </div>
      <ul className="fsr-money__rows">
        {shown.map((s) => (
          <li key={s.key} className="fsr-money__row" data-tone={s.tone}>
            <Swatch kind={SWATCH[s.tone]} className="fsr-money__swatch" />
            <span className="fsr-money__name fs-t-label">{s.label}</span>
            {s.count !== undefined && <span className="fsr-money__count fs-t-caption">{s.count}</span>}
            {s.note && <span className="fsr-money__note fs-t-caption">{s.note}</span>}
            <MoneyFigure display={s.amount} className="fsr-money__amount fs-t-figure" />
          </li>
        ))}
      </ul>
    </figure>
  );
}
