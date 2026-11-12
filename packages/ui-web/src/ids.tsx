// Ids that never break mid-word (UI gate round 4). A key id, a hash or a run id prints on one line in the mono; a
// long one is cut in the middle ("fs-ernesto…mj2ng2"), never at an end, and the whole id stays its title and its
// accessible name, so nothing is lost to a reader or a screen reader.

/** The separators an id's cut never leaves hanging at either side of the ellipsis. */
const EDGE = /^[-_.:/\s]+|[-_.:/\s]+$/g;

/**
 * `value` in at most `max` characters: whole when it fits, else its head and its last `tail` characters around one
 * ellipsis (the tail defaults to half the room). A separator at the cut is dropped, so "fs-analyn-demo-v9kuqr" in 17
 * with a tail of 6 reads "fs-analyn…v9kuqr".
 */
export function truncateMiddle(value: string, max: number, tail?: number): string {
  if (value.length <= max || max < 3) return value;
  const back = Math.max(1, Math.min(tail ?? Math.floor((max - 1) / 2), max - 2));
  const front = Math.max(1, max - 1 - back);
  const head = value.slice(0, front).replace(EDGE, "");
  const end = value.slice(value.length - back).replace(EDGE, "");
  return `${head}…${end}`;
}

export interface IdTextProps {
  /** The whole id: its title and what a screen reader hears. */
  readonly value: string;
  /** The most characters shown (default 20); a longer id is cut in the middle. */
  readonly max?: number;
  /** How many of the id's last characters always show (they tell keys and hashes apart). */
  readonly tail?: number;
  readonly testId?: string;
  readonly className?: string;
}

/** An id, hash or key in the mono's `id` role, on one line, middle-truncated, the whole value as its title. */
export function IdText({ value, max = 20, tail, testId, className }: IdTextProps) {
  const shown = truncateMiddle(value, max, tail);
  return (
    <span
      className={["fs-idtext", "fs-t-id", className].filter(Boolean).join(" ")}
      title={value}
      data-testid={testId}
    >
      <span aria-hidden>{shown}</span>
      <span className="fs-sr">{value}</span>
    </span>
  );
}
