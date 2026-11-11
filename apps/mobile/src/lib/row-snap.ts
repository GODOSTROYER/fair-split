/**
 * Rows never end under the tab bar (UI gate round 4). A scrolled list at rest shows each row whole or not at all: the
 * row its viewport's bottom edge would cut is covered, from its top down, in the screen's own surface, so a member
 * never reads half of "CBU R1" over the navigation bar. While she scrolls nothing is covered; the cover is placed
 * again once the list comes to rest. Pure, tested in Node; `ui/chrome.tsx` draws it.
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
