// One 12-column grid for every console screen (UI gate round 4). A screen's root takes `fsc-screen` (ScreenRoot's
// `grid` prop), so it fills the stage's screen panel with twelve columns and a 24 px gutter, top-aligned: its title
// row first (ScreenHead), then its content 32 px under it. Nothing is centred in a tall panel and a card hugs its
// content (cells align to the start, never stretch, unless a cell asks to). A Cell spans `span` columns where the
// screen panel is wide (1,040 px and up: 1,920 with the phone docked or folded), `spanMd` from 720 px (1,280 and
// 1,470), and the whole row below that; `start` pins its first column on the wide grid.
// Round 5, the title row: every screen is a noun title with a grey suffix ("Season 2026-A"), its state in a
// StatusChip on the same row, then one id line: the run id in the mono and one provenance phrase in words
// ("Synthetic co-op · seeded slips"), which replaces every inline legend glyph on the screen.

import type { CSSProperties, ElementType, ReactNode } from "react";
import type { ProvenancePhrase } from "./copy.js";

export type GridSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** The class a screen root takes to sit on the grid (ScreenRoot's `grid` prop sets it). */
export const SCREEN_GRID = "fsc-screen";

export interface ScreenHeadProps {
  /** The screen's title, a noun on the title step ("Season", "Split review"). */
  readonly title: ReactNode;
  /** The grey suffix after the title, in the same heading ("2026-A"): ink-2, so the heading reads "Season 2026-A". */
  readonly suffix?: ReactNode;
  /** The screen's state on the title row: one StatusChip ("Awaiting payment", "Funded", "PayPal complete · cash due"). */
  readonly status?: ReactNode;
  /** The heading's id, for the screen root's aria-labelledby. */
  readonly titleId?: string;
  /** The id line's id beside the title ("2026-A · r2"), in the mono's id role. One run id everywhere. */
  readonly meta?: ReactNode;
  /** The screen's one provenance phrase, after the id ("Synthetic co-op · seeded slips"), its sentence its title. */
  readonly provenance?: ProvenancePhrase;
  /** Controls at the row's end (a toggle, a link); never the screen's primary, which lives with its content. */
  readonly actions?: ReactNode;
  readonly testId?: string;
  readonly className?: string;
}

const present = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false;

/** The title row: the title and its grey suffix, the state's chip, the id line, and at most a quiet control. */
export function ScreenHead({
  title,
  suffix,
  status,
  titleId,
  meta,
  provenance,
  actions,
  testId,
  className,
}: ScreenHeadProps) {
  const hasMeta = present(meta);
  return (
    <header className={["fsc-screen__head", className].filter(Boolean).join(" ")} data-testid={testId}>
      <h1 id={titleId} className="fsc-screen__title fs-t-title">
        {title}
        {present(suffix) && (
          <>
            {" "}
            <span className="fsc-screen__suffix">{suffix}</span>
          </>
        )}
      </h1>
      {present(status) && <div className="fsc-screen__status">{status}</div>}
      {(hasMeta || provenance) && (
        <p className="fsc-screen__meta">
          {hasMeta && <span className="fsc-screen__id fs-t-id">{meta}</span>}
          {hasMeta && provenance && (
            <span className="fsc-screen__sep" aria-hidden>
              {" · "}
            </span>
          )}
          {provenance && (
            <span
              className="fsc-screen__provenance fs-t-caption"
              title={provenance.title}
              data-testid={testId ? `${testId}.provenance` : undefined}
            >
              {provenance.text}
              <span className="fs-sr">{`. ${provenance.title}`}</span>
            </span>
          )}
        </p>
      )}
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
