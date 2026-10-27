// Anthropic's TypeScript reference implementation, verbatim
// (https://platform.claude.com/docs/en/build-with-claude/vision-coordinates, "Resize your image
// before uploading"), plus the high-resolution-tier limits S4.2 uses. Only `export` was added.

/** High-resolution tier (Claude 4.7 and later models): 2,576 px long edge, 4,784 visual tokens. */
export const HIGH_RES_MAX_EDGE = 2576;
export const HIGH_RES_MAX_TOKENS = 4784;

/** Visual tokens consumed by an image: one token per 28x28 pixel patch. */
export function countImageTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/**
 * Round half to even (banker's rounding), matching Python's round(). The
 * live API resolves exact .5 ties toward the even neighbor, so Math.round
 * (which rounds halves up) would compute a different size for some images.
 */
function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The size Claude resizes an image to before padding.
 *
 * Defaults are for the standard resolution tier. For high-resolution-tier
 * models, use maxEdge = 2576 and maxTokens = 4784. Returns [width, height].
 * Images that already fit within the limits are returned unchanged.
 */
export function resizedSize(
  width: number,
  height: number,
  maxEdge = 1568,
  maxTokens = 1568,
): [number, number] {
  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / 28) * 28 <= maxEdge &&
    Math.ceil(h / 28) * 28 <= maxEdge &&
    countImageTokens(w, h) <= maxTokens;

  if (fits(width, height)) {
    return [width, height];
  }
  if (height > width) {
    const [resizedH, resizedW] = resizedSize(height, width, maxEdge, maxTokens);
    return [resizedW, resizedH];
  }

  // Binary search along the long edge for the largest aspect-preserving
  // size that fits.
  const aspectRatio = width / height;
  let lo = 1; // lo always fits
  let hi = width; // hi never fits
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspectRatio), 1))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lo, Math.max(roundTiesToEven(lo / aspectRatio), 1)];
}
