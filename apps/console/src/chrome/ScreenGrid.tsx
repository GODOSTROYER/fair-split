// One 12-column grid for every console screen (UI gate round 4). A screen's root takes `fsc-screen` (ScreenRoot's
// `grid` prop), so it fills the stage's screen panel with twelve columns and a 24 px gutter, top-aligned: its title
// row first (ScreenHead), then its content 32 px under it. Nothing is centred in a tall panel and a card hugs its
// content (cells align to the start, never stretch, unless a cell asks to). A Cell spans `span` columns where the
// screen panel is wide (1,040 px and up: 1,920 with the phone docked or folded), `spanMd` from 720 px (1,280 and
// 1,470), and the whole row below that; `start` pins its first column on the wide grid.

import type { CSSProperties, ElementType, ReactNode } from "react";

export type GridSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** The class a screen root takes to sit on the grid (ScreenRoot's `grid` prop sets it). */
export const SCREEN_GRID = "fsc-screen";

export interface ScreenHeadProps {
  /** The screen's title, on the title step. */
  readonly title: ReactNode;
  /** The heading's id, for the screen root's aria-labelledby. */
  readonly titleId?: string;
  /** The id line beside the title ("2026-A · r2"), in the mono's id role. */
  readonly meta?: ReactNode;
  /** Controls at the row's end (a toggle, a link); never the screen's primary, which lives with its content. */
  readonly actions?: ReactNode;
  readonly testId?: string;
  readonly className?: string;
}

/** The title row: the title, its id line, and at most a quiet control at the end, on one baseline. */
export function ScreenHead({ title, titleId, meta, actions, testId, className }: ScreenHeadProps) {
  return (
    <header className={["fsc-screen__head", className].filter(Boolean).join(" ")} data-testid={testId}>
      <h1 id={titleId} className="fsc-screen__title fs-t-title">
        {title}
      </h1>
      {meta !== undefined && meta !== null && <p className="fsc-screen__meta fs-t-id">{meta}</p>}
      {actions && <div className="fsc-screen__actions">{actions}</div>}
    </header>
  );
}

export interface CellProps {
  /** Columns on the wide grid (screen panel ≥ 1,040 px). Default: the whole row. */
  readonly span?: GridSpan;
  /** Columns from 720 px (1,280 and 1,470); default: the whole row. */
  readonly spanMd?: GridSpan;
  /** The first column on the wide grid (1-based). */
  readonly start?: GridSpan;
  /** Stretch to the row's height (two cards that must end level); by default a cell hugs its content. */
  readonly stretch?: boolean;
  readonly as?: ElementType;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
  readonly children?: ReactNode;
  readonly "aria-labelledby"?: string;
  readonly "aria-label"?: string;
}

/** A block on the screen's grid. */
export function Cell({
  span,
  spanMd,
  start,
  stretch = false,
  as: Tag = "div",
  className,
  style,
  testId,
  children,
  ...aria
}: CellProps) {
  return (
    <Tag
      className={["fsc-cell", className].filter(Boolean).join(" ")}
      data-span={span}
      data-span-md={spanMd}
      data-start={start}
      data-stretch={stretch ? "" : undefined}
      style={style}
      data-testid={testId}
      {...aria}
    >
      {children}
    </Tag>
  );
}
