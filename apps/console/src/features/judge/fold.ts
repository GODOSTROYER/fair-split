// Where the first view's paper starts (S1.6 J1; design §1, signature 1; S2.12's G1 squint test needs the focal
// element in the first screen). jsdom lays nothing out, so the composition's vertical budget is written down
// here from the stage's chrome and the first view's rows, as stage.css, judge.css and season.css draw them, and
// the layout test holds the desk to the fold at the stage's capture sizes. Each row is its tallest case: the
// head with two lines of lede, the pool's strip with its parts stacked (a narrow column) and the funded line
// under it, the desk's note on three lines. Measured in Chromium (Playwright, mock data): the desk's top at
// 456 px of 956 at 1470 × 956, 482 px of 800 at 1280 × 800, with its first row of prints above the ribbon.

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The stage around the console's screen, from 1280 px wide (stage.css): the bar and the run pill's row above;
 * the ribbon (three log rows) and the honesty caption below. */
export const STAGE_CHROME = { top: 52 + 58, bottom: 77 + 30 } as const;

/** `.fsc-console__screen`'s top padding (stage.css). */
export const SCREEN_PAD_TOP = 28;

/** The first view's rows above the paper, each at its tallest. */
export const FIRST_VIEW_ROWS = {
  /** The stencil (20), the co-op (6 + 16), the title (12 + 34) and two lines of lede (12 + 44). */
  head: 144,
  /** `.fsc-first`'s gap between the head and the money. */
  gap: 32,
  /** The pool's strip: its title row and one band (amount and parts), parts stacked in a narrow column. */
  poolStrip: 144,
  /** "The payment was recorded…": the funded line under the strip, two lines. */
  fundedLine: 48,
  /** The desk layout's row gap between the strip and the paper. */
  stripGap: 24,
  /** The desk's title and its note on three lines, and the gap to the first print. */
  deskHead: 66,
} as const;

/** The top of the desk (its title), in viewport px. */
export function deskTop(funded = false): number {
  const r = FIRST_VIEW_ROWS;
  return (
    STAGE_CHROME.top +
    SCREEN_PAD_TOP +
    r.head +
    r.gap +
    r.poolStrip +
    (funded ? r.fundedLine : 0) +
    r.stripGap
  );
}

/** The top of the first row of prints, in viewport px. */
export function paperTop(funded = false): number {
  return deskTop(funded) + FIRST_VIEW_ROWS.deskHead;
}

/** The fold: where the ribbon starts, in viewport px. */
export function foldAt(viewport: Viewport): number {
  return viewport.height - STAGE_CHROME.bottom;
}
