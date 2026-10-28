// An inner scroller a keyboard can reach (WCAG 2.1.1, axe `scrollable-region-focusable`): a named region in the
// tab order, so arrow keys and Page Up/Down scroll it in every browser (Safari does not focus scrollers on its
// own), with the console's one focus ring. Use it for a box with a max-height or overflow and nothing focusable
// inside (run-log lanes, wide tables on a phone, /ops's tables). Its name differs from the section around it
// (landmarks are named uniquely).

import type { ReactNode } from "react";

export interface ScrollRegionProps {
  readonly className: string;
  /** The ID of the heading that names it, or… */
  readonly labelledBy?: string;
  /** …its name, when no heading is near. */
  readonly label?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function ScrollRegion({ className, labelledBy, label, testId, children }: ScrollRegionProps) {
  return (
    <section
      className={className}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must take focus to scroll by keyboard.
      tabIndex={0}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      data-scroll-region=""
      data-testid={testId}
    >
      {children}
    </section>
  );
}
