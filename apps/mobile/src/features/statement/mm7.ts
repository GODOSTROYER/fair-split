/**
 * MM-7 "Tap a peso" (S2.9) as pure functions, tested in Node and run as worklets on the UI thread:
 * - `traceState`: the `data-trace` the statement exposes for each phase (S1.9: closed → line → slip);
 * - `zoomLimit`: how far the crop may zoom before source pixels run out (`sMax`, capped at 2.4);
 * - `zoomTransform`: the crop growing from the tapped chip into place (scale about the tap point, `glide`);
 * - `hapticAt`: the progress at which the Rigid / Segment_Tick haptic fires, two-thirds of the way in.
 */
import type { MomentPhase } from "../../_shims/moments";
import { TIMELINE } from "../../_shims/motion";

export type TraceState = "closed" | "line" | "slip";

export function traceState(phase: MomentPhase<"MM-7">): TraceState {
  if (phase === "rest") return "closed";
  if (phase === "framed" || phase === "expanded") return "line";
  return "slip";
}

/**
 * `sMax = min(2.4, tileSourcePx / (fieldWidthDp · pixelRatio))` (S2.7 CropZoom). A crop drawn in vectors (the
 * labelled sample) has no source limit.
 */
export function zoomLimit(source: { px: number; fieldDp: number; pixelRatio: number } | null): number {
  const max = TIMELINE["MM-7"].zoomMax;
  if (!source || source.fieldDp <= 0 || source.pixelRatio <= 0) return max;
  return Math.max(1, Math.min(max, source.px / (source.fieldDp * source.pixelRatio)));
}

export interface Point {
  x: number;
  y: number;
}

/**
 * At progress `k` (0 at the tapped chip, 1 in place) the crop sits centred on the chip at `1/zoom` of its size and
 * glides to its own centre at full size: a zoom of `zoom`× about the tap point.
 */
export function zoomTransform(k: number, origin: Point, centre: Point, zoom: number) {
  "worklet";
  const s = 1 / zoom + (1 - 1 / zoom) * k;
  return {
    translateX: (origin.x - centre.x) * (1 - k),
    translateY: (origin.y - centre.y) * (1 - k),
    scale: s,
  };
}

/** The progress at which the zoom "commits" (the haptic): two-thirds of the way in. */
export function hapticAt(): number {
  return TIMELINE["MM-7"].hapticAt;
}
