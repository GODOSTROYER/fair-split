// A screen's root element: `data-testid="{screenId}"` and the S1 `data-state` (register §4, S2.0 rule 4).
// Every console screen renders exactly one. The state type only accepts that screen's S1 names.

import type { ReactNode } from "react";
import type { ConsoleScreenId, ScreenState } from "../lib/screens.js";
import { SCREEN_GRID } from "./ScreenGrid.js";

export interface ScreenRootProps<S extends ConsoleScreenId> {
  readonly id: S;
  readonly state: ScreenState<S>;
  readonly children: ReactNode;
  readonly className?: string;
  /** The heading that names the screen, for aria-labelledby. */
  readonly labelledBy?: string;
  readonly as?: "section" | "main" | "article";
  /**
   * Sit on the one 12-column grid (UI gate round 4, docs/DESIGN.md §3): the root takes `fsc-screen`, its children
   * are a ScreenHead and Cells, top-aligned 32 px under the title row.
   */
  readonly grid?: boolean;
}

export function ScreenRoot<S extends ConsoleScreenId>({
  id,
  state,
  children,
  className,
  labelledBy,
  as: Tag = "section",
  grid = false,
}: ScreenRootProps<S>) {
  return (
    <Tag
      className={[grid ? SCREEN_GRID : null, className].filter(Boolean).join(" ") || undefined}
      data-testid={id}
      data-screen={id}
      data-state={state}
      aria-labelledby={labelledBy}
      // A page's own landmark (Proof, the brand view, /ops) is where a focus hand-off lands when the page has no
      // control yet (it is still loading). It draws no tabindex: lib/focus.ts lends it tabindex="-1" only while
      // that hand-off holds focus there, so a click in the page's text never moves the focus starting point.
    >
      {children}
    </Tag>
  );
}
