// Two small parts with one look on the console and the phone (UI gate round 4).
// - ReceiptChip: a slip a line was weighed on, as data, not paper: its serial in the id style (ink-3) and its verified
//   kilos in ink with tabular figures, flat on a 1 px rule. No evidence red, no ballpoint blue: those colours belong
//   to the evidence paper itself, never to a chip about it.
// - Avatar: a person's initials, white with a 1 px ink-2 ring and ink initials. Indigo is for action only, so a
//   person (the treasurer the judge acts as, a signer, the clerk who entered a slip) is never an indigo tile.

export interface ReceiptChipProps {
  /** The slip's serial, as printed ("0403"). */
  readonly serial: string;
  /** Its verified kilos, already formatted ("38.45"). */
  readonly kilos: string;
  /** The chip's accessible name when it says more than its two figures ("Slip 0403, 38.45 kg"). */
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
}

export function ReceiptChip({ serial, kilos, label, testId, className }: ReceiptChipProps) {
  return (
    <span
      className={["fs-receipt-chip", className].filter(Boolean).join(" ")}
      data-testid={testId}
      {...(label ? { role: "img", "aria-label": label, title: label } : {})}
    >
      <span className="fs-receipt-chip__serial fs-t-id" aria-hidden={label ? true : undefined}>
        {serial}
      </span>
      <span className="fs-receipt-chip__kg fs-t-figure" aria-hidden={label ? true : undefined}>
        {kilos}
      </span>
    </span>
  );
}

export interface AvatarProps {
  /** One or two letters. */
  readonly initials: string;
  /** Who it is, in full: the accessible name and the title. Omit when the name is printed beside it. */
  readonly name?: string;
  readonly testId?: string;
  readonly className?: string;
}

export function Avatar({ initials, name, testId, className }: AvatarProps) {
  return (
    <span
      className={["fs-avatar", className].filter(Boolean).join(" ")}
      data-testid={testId}
      {...(name ? { role: "img", "aria-label": name, title: name } : { "aria-hidden": true })}
    >
      <span className="fs-t-stamp" aria-hidden>
        {initials}
      </span>
    </span>
  );
}
