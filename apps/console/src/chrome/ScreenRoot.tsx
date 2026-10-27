// A screen's root element: `data-testid="{screenId}"` and the S1 `data-state` (register §4, S2.0 rule 4).
// Every console screen renders exactly one. The state type only accepts that screen's S1 names.

import type { ReactNode } from "react";
import type { ConsoleScreenId, ScreenState } from "../lib/screens.js";

export interface ScreenRootProps<S extends ConsoleScreenId> {
  readonly id: S;
  readonly state: ScreenState<S>;
  readonly children: ReactNode;
  readonly className?: string;
  /** The heading that names the screen, for aria-labelledby. */
  readonly labelledBy?: string;
  readonly as?: "section" | "main" | "article";
}

export function ScreenRoot<S extends ConsoleScreenId>({
  id,
  state,
  children,
  className,
  labelledBy,
  as: Tag = "section",
}: ScreenRootProps<S>) {
  return (
    <Tag
      className={className}
      data-testid={id}
      data-screen={id}
      data-state={state}
      aria-labelledby={labelledBy}
    >
      {children}
    </Tag>
  );
}
