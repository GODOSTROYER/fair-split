/**
 * The capture quality gate (M-CL-01 `quality`: "Ngitngit kaayo. I-scan pag-usab."). A cheap, honest heuristic that
 * runs on any phone without decoding pixels: a 1,600 px JPEG of a real slip at quality 0.82 carries detail
 * (about 0.08 to 0.2 bytes per pixel), while a dark or badly blurred frame compresses to almost nothing. The gate
 * only asks; the clerk can keep the page, and the reading pipeline makes the final call.
 *
 * Pure (tested in Node).
 */
export type QualityIssue = "dark" | "small";

/** Below this many JPEG bytes per pixel a page holds too little detail to read. */
export const DARK_BYTES_PER_PIXEL = 0.012;
/** A page whose long edge is shorter than this cannot hold block capitals legibly. */
export const MIN_LONG_EDGE = 800;

export function qualityIssue(p: {
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}): QualityIssue | null {
  // Samples (SVG) and lossless images are not judged: the heuristic is about JPEG photographs.
  if (!/^image\/jpe?g$/i.test(p.mime)) return null;
  const w = p.width ?? 0;
  const h = p.height ?? 0;
  if (w <= 0 || h <= 0) return null;
  if (Math.max(w, h) < MIN_LONG_EDGE) return "small";
  if (p.bytes / (w * h) < DARK_BYTES_PER_PIXEL) return "dark";
  return null;
}
