// A count or a reading set as a number (UI gate round 3: no dot-matrix, one family). FS Sans, tabular lining
// figures, on one of the type steps: the hero step for a screen's one hero count (48/48, 7/8, 6/6), the title
// step beside a dial, the body step inline. Its spoken value is its accessible name; with words beside it already
// saying the same, it is hidden from assistive technology. Never money: an amount is MoneyFigure or AmountDisplay.

export interface NumeralProps {
  /** What it reads: "48/48", "1.62", "7/8". */
  readonly value: string;
  /** The spoken value ("48 of 48 slips read", "1.62 percent"); not needed when `decorative`. */
  readonly label?: string;
  /** The type step it sits on: hero (56/48 sp) by default, title (24), body (16). */
  readonly size?: "hero" | "title" | "body";
  /** ink: a checked reading; dim (ink-3): nothing checked yet. */
  readonly tone?: "ink" | "dim";
  /** The words beside it already say it: hide it from assistive technology. */
  readonly decorative?: boolean;
  readonly testId?: string;
  readonly className?: string;
}

export function Numeral({
  value,
  label,
  size = "hero",
  tone = "ink",
  decorative = false,
  testId,
  className,
}: NumeralProps) {
  const classes = ["fs-numeral", `fs-t-${size}`, className].filter(Boolean).join(" ");
  if (!decorative && label !== undefined) {
    return (
      <span
        className={classes}
        role="img"
        aria-label={label}
        data-value={value}
        data-tone={tone}
        data-testid={testId}
      >
        {value}
      </span>
    );
  }
  return (
    <span
      className={classes}
      aria-hidden={decorative ? true : undefined}
      data-value={value}
      data-tone={tone}
      data-testid={testId}
    >
      {value}
    </span>
  );
}
