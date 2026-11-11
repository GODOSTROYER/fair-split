// One marker vocabulary on the console, Proof and the phone (UI gate round 5, docs/DESIGN.md §4 "Markers").
// - StateDot (honesty.tsx): an 8 px round dot for a state, colour in the dot, the word beside it.
// - CheckMark: a 16 px line ✓ in ink and the word in ink, for a check that held. Never a filled disc.
// - StepNumber: a 24 px circle in a 1 px ink-2 outline with an ink numeral, for a step in a chain. Never a filled disc.
// - Swatch: the one square, only as a chart legend's key (a jade bar's, a hatched bar's), 8 or 12 px.
// Hatch means cash and jade means money the simulated PayPal confirmed, here as everywhere.

import type { ReactNode } from "react";

export interface CheckMarkProps {
  /** The word that says what held ("Matches", "Holds resolved"). Omit only when the words sit right beside it. */
  readonly children?: ReactNode;
  readonly testId?: string;
  readonly className?: string;
}

/** A check that held: a 16 px line ✓ in ink, then its word in ink. The ✓ is hidden; the word says it. */
export function CheckMark({ children, testId, className }: CheckMarkProps) {
  return (
    <span className={["fs-check", className].filter(Boolean).join(" ")} data-testid={testId}>
      <svg
        className="fs-check__tick"
        width={16}
        height={16}
        viewBox="0 0 16 16"
        aria-hidden
        focusable="false"
      >
        <path
          d="M3.25 8.4 6.5 11.5 12.75 4.75"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children !== undefined && children !== null && <span className="fs-check__word">{children}</span>}
    </span>
  );
}

export interface StepNumberProps {
  /** The step's place in the chain (1-based). */
  readonly n: number;
  /** The accessible name when no words sit beside it ("Step 2"); omitted, the numeral is hidden. */
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
}

/** A step in a chain: a 24 px circle, a 1 px ink-2 outline, an ink numeral on the label step. */
export function StepNumber({ n, label, testId, className }: StepNumberProps) {
  return (
    <span
      className={["fs-step", className].filter(Boolean).join(" ")}
      data-testid={testId}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className="fs-step__n">{n}</span>
    </span>
  );
}

export type SwatchKind = "paid" | "cash" | "held" | "planned" | "ink";

export interface SwatchProps {
  /** paid: jade (confirmed money); cash: hatch; held: amber; planned: solid steel; ink: ink. */
  readonly kind: SwatchKind;
  /** 8 px beside a legend row; 12 px beside a hero's word. */
  readonly size?: 8 | 12;
  readonly testId?: string;
  readonly className?: string;
}

/** A chart legend's key: the only square in the vocabulary. Hidden; the legend's word says what it keys. */
export function Swatch({ kind, size = 8, testId, className }: SwatchProps) {
  return (
    <span
      className={["fs-swatch", className].filter(Boolean).join(" ")}
      data-kind={kind}
      data-size={size}
      data-testid={testId}
      aria-hidden
    />
  );
}
