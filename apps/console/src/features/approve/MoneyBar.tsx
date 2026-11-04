// The money bar (unslop spec §1.9) for Approve and Run: one stacked bar, each segment as wide as its money, and a
// legend row per segment (swatch, name, count, a micro note, the amount). Colour is only meaning: jade is money the
// simulated PayPal confirmed, a dashed jade outline is money in flight, marigold waits on a person, hatch is cash,
// ink-3 is kept for members, and an ink-3 outline is a batch not sent yet. The bar is decoration for the legend,
// which carries every figure in words.

import type { CSSProperties, ReactNode } from "react";
import "./money-bar.css";

export type MoneyTone = "planned" | "flight" | "confirmed" | "held" | "failed" | "cash" | "kept";

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
  /** A short visible title for the head row ("By value"). */
  readonly title?: string;
  /** The honesty tag for the PayPal values this bar holds, at the right of the head row. */
  readonly tag?: ReactNode;
  /** A line under the legend (a labelled replay says where its statuses came from). */
  readonly footnote?: ReactNode;
  readonly label: string;
  readonly testId?: string;
  readonly className?: string;
}

export function MoneyBar({ segments, title, tag, footnote, label, testId, className }: MoneyBarProps) {
  const shown = segments.filter((s) => s.cents > 0 || s.count);
  return (
    <figure className={["fsr-money", className].filter(Boolean).join(" ")} data-testid={testId}>
      <figcaption className="fs-sr">{label}</figcaption>
      {(title || tag) && (
        <div className="fsr-money__head" aria-hidden={title && !tag ? true : undefined}>
          {title && <span className="fsr-money__title fs-t-label">{title}</span>}
          {tag}
        </div>
      )}
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
            <span className="fsr-money__swatch" data-tone={s.tone} aria-hidden />
            <span className="fsr-money__name fs-t-label">{s.label}</span>
            {s.count !== undefined && <span className="fsr-money__count fs-t-micro">{s.count}</span>}
            {s.note && <span className="fsr-money__note fs-t-micro">{s.note}</span>}
            <span className="fsr-money__amount fs-t-figure">{s.amount}</span>
          </li>
        ))}
      </ul>
      {footnote && <p className="fsr-money__foot fs-t-micro">{footnote}</p>}
    </figure>
  );
}
