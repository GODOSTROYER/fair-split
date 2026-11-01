// MM-2 "Paper prints itself" (S2.9), as numbers the reading room draws with. Every time comes from
// @fairsplit/motion's timeline for the "row" act (IC-10), so the band, the lift, the flight, the resolve, the
// print and the ring land exactly where the phase machine says; nothing here invents a duration.

import { EASE, FLIGHTS, type MotionMode, TIMELINES, TWEENS } from "@fairsplit/motion";

const rowAct = TIMELINES["MM-2"].acts.find((a) => a.id === "row");

function at(phase: string, steps = rowAct?.full ?? []): number {
  return steps.find((s) => s.phase === phase)?.at ?? 0;
}

/** When each phase of a row starts, in ms from its `extract.row` (full motion). */
export const ROW_AT = {
  band: at("band"),
  lift: at("lift"),
  flight: at("flight"),
  resolve: at("resolve"),
  print: at("print"),
  ring: at("ring"),
  landed: at("landed"),
} as const;

const resolveStep = rowAct?.full.find((s) => s.phase === "resolve");

export const ROW_MS = {
  band: TWEENS.band.ms,
  lift: TWEENS.lift.ms,
  flight: TWEENS.flight.ms,
  resolve:
    resolveStep?.motion && "ms" in resolveStep.motion ? resolveStep.motion.ms : ROW_AT.print - ROW_AT.resolve,
  print: TWEENS.print.ms,
  ring: TWEENS.ring.ms,
  /** Reduced motion: colour and opacity only. */
  reduced: TWEENS.reduced.ms,
} as const;

/** The flight's curve, as CSS. */
export const FLIGHT_EASE = `cubic-bezier(${EASE.press.join(", ")})`;
export const LIFT_EASE = `cubic-bezier(${EASE.out.join(", ")})`;

/** S2.9: at most eight crops fly at once (three on the low tier); later rows land without flying. */
export function maxFlights(mode: MotionMode): number {
  return mode === "full" ? FLIGHTS.full : 0;
}

/** The crop lifts to this scale before it flies (S2.9 "scale 1 → 1.04"). */
export const LIFT_SCALE = 1.04;
/** Handwriting blurs out and the typeset digits sharpen in, by this many px (S2.9). */
export const RESOLVE_BLUR_PX = 2;
/** The flight's control point sits this far above the straight line (design §3 "flight"). */
export const FLIGHT_BOW_PX = 40;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Points along the quadratic flight from one box's centre to another's, control point bowed upward. */
export function flightPath(from: Box, to: Box, samples = 12): { x: number; y: number }[] {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - FLIGHT_BOW_PX };
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return out;
}

/**
 * The flight as transform keyframes for an element laid out at `from`: it travels the curve and scales to the
 * bed's size, starting from the lifted scale.
 */
export function flightKeyframes(from: Box, to: Box, samples = 12): Keyframe[] {
  const path = flightPath(from, to, samples);
  const a = path[0] ?? { x: 0, y: 0 };
  const scaleEnd = from.width > 0 ? Math.min(to.width / from.width, to.height / Math.max(from.height, 1)) : 1;
  return path.map((p, i) => {
    const t = i / samples;
    const s = LIFT_SCALE + (scaleEnd - LIFT_SCALE) * t;
    return { offset: t, transform: `translate(${p.x - a.x}px, ${p.y - a.y}px) scale(${s})` };
  });
}
