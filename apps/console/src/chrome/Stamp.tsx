// The ink stamp a person leaves on a decision, as the console draws it: ui-web's InkStamp look (the 18 px ink
// square with the initials, `.fs-stamp`, the time on hover), with an accessible name a screen reader reads in full
// and axe accepts. ui-web's own puts aria-label on an <abbr>, a role that allows no name (axe aria-prohibited-attr):
// some readers then say only "AS". Here the stamp is an image named "Analyn R. Sumalinog, 02:43:33"; the initials
// are its picture. Reported to WS-DS for ui-web's InkStamp (SPLIT.md Known gaps).

import type { StampView } from "@fairsplit/ui-web";

export interface StampProps {
  readonly stamp: StampView;
  readonly testId?: string;
}

export function Stamp({ stamp, testId }: StampProps) {
  const full = `${stamp.name}, ${stamp.at}`;
  return (
    <span className="fs-stamp" role="img" aria-label={full} title={full} data-testid={testId}>
      <span className="fs-t-stamp" aria-hidden="true">
        {stamp.initials}
      </span>
    </span>
  );
}
