// The 12 px fade above the navigation bar (UI gate round 3): a screen's scrolled content ends above the tab bar in
// a fade to the bar's own plate, never a hard cut through a line of words. React Native has no gradient here, so the
// fade is four 3 px bands of the plate colour, each more opaque than the one above it, drawn over the content's
// last 12 px and never taking a touch.

/** The fade's height in px. */
export const NAV_FADE_PX = 12;

export interface FadeBand {
  /** Offset from the fade's top, px. */
  readonly top: number;
  readonly height: number;
  /** The plate's opacity in this band. */
  readonly opacity: number;
}

/** The bands, top (faint) to bottom (nearly the plate). */
export function navFadeBands(height: number = NAV_FADE_PX, steps = 4): readonly FadeBand[] {
  const band = height / steps;
  return Array.from({ length: steps }, (_, i) => ({
    top: i * band,
    height: band,
    opacity: Math.round(((i + 1) / (steps + 1)) * 100) / 100,
  }));
}

/**
 * The top fade under the status inset (UI gate round 4): the same bands upside down, nearly the surface at the top and
 * faint at the bottom, so content scrolled up under the inset fades out instead of being cut through a line.
 */
export function topFadeBands(height: number, steps = 4): readonly FadeBand[] {
  const bands = navFadeBands(height, steps);
  return bands.map((b, i) => ({ ...b, opacity: bands[steps - 1 - i]?.opacity ?? b.opacity }));
}
