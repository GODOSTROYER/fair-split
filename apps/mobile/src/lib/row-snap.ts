/**
 * Rows never end under the tab bar (UI gate round 4). A scrolled list at rest shows each row whole or not at all: the
 * row its viewport's bottom edge would cut is covered, from its top down, in the screen's own surface, so a member
 * never reads half of "CBU R1" over the navigation bar. While she scrolls nothing is covered; the cover is placed
 * again once the list comes to rest. A row that ends inside the bar's 12 px fade counts as cut. Pure, tested in Node;
 * `ui/chrome.tsx` measures the rows a screen's blocks register (`SnapRow`) and draws the cover.
 */

/** A row's top and bottom in the scrolled content's coordinates (px from the content's top). */
export interface RowBox {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where the cover starts, in the viewport's coordinates (px from its top), when the list rests at `scrollY` in a
 * viewport `viewport` px tall: the top of the row the bottom edge cuts. Null when no row is cut, or when the cut row
 * starts at or above the viewport's top (a row taller than the view is never hidden whole).
 */
export function rowSnapCover(rows: readonly RowBox[], scrollY: number, viewport: number): number | null {
  if (!(viewport > 0)) return null;
  const edge = scrollY + viewport;
  let cut: RowBox | null = null;
  for (const row of rows) {
    if (row.top < edge && row.bottom > edge && (cut === null || row.top > cut.top)) cut = row;
  }
  if (!cut) return null;
  const from = cut.top - scrollY;
  return from > 0 ? from : null;
}

/** How long a list must be still before it counts as at rest (web frames send no momentum end), ms. */
export const SNAP_REST_MS = 120;

/** How long a screen waits after its content changed size before measuring its rows (a row's glide settles), ms. */
export const SNAP_SETTLE_MS = 400;

/** A view a screen can measure: React Native's `measureInWindow` (every host view has it, on the web too). */
export interface SnapNode {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/**
 * Where a row stops counting as whole: the viewport's bottom less the fade the bar above it draws (a row that ends in
 * the fade is cut through its last line), never above the viewport's top.
 */
export function snapEdge(viewport: number, fade: number): number {
  return Math.max(0, viewport - fade);
}

/**
 * The cover for rows in the viewport's coordinates, at rest, under a bar that fades `fade` px over the content: from
 * the top of the row the fade's top edge cuts, or from that edge when a row only starts inside the fade (a sliver of
 * it would show). Null when every visible row is whole.
 */
export function snapCoverFrom(rows: readonly RowBox[], viewport: number, fade: number): number | null {
  const edge = snapEdge(viewport, fade);
  const cut = rowSnapCover(rows, 0, edge);
  if (cut !== null) return cut;
  return edge > 0 && rows.some((r) => r.top >= edge && r.top < viewport) ? edge : null;
}

/** Rows measured in the window, as boxes in the viewport's coordinates (its top at `viewportTop` in the window). */
export function viewportRows(
  viewportTop: number,
  rows: readonly { readonly y: number; readonly height: number }[],
): RowBox[] {
  return rows
    .filter((r) => r.height > 0)
    .map((r) => ({ top: r.y - viewportTop, bottom: r.y - viewportTop + r.height }));
}
