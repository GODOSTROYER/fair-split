// Closed-form evaluation of the presets, used by poseAt() for the G1 motion studies, by the CSS `linear()`
// spring easings in @fairsplit/tokens, and by tests. Pure maths, no platform code.

import { type Bezier, EASE, type EaseName, SPRINGS, type SpringName } from "./presets.js";

/** Evaluates a CSS cubic-bezier timing function at progress x ∈ [0,1]. */
export function cubicBezier(curve: Bezier, x: number): number {
  const [x1, y1, x2, y2] = curve;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  const dx = (t: number) => 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
  // Newton first, bisection as the fallback when the slope is flat.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bx(t) - x;
    if (Math.abs(err) < 1e-7) return by(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 60; i++) {
    const v = bx(t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

export function ease(name: EaseName, x: number): number {
  return cubicBezier(EASE[name], x);
}

/**
 * Normalised step response of a mass-1 spring released from rest: 0 at t = 0, approaching 1.
 * `ms` is the time since the target changed.
 */
export function springResponse(name: SpringName, ms: number): number {
  const { stiffness, damping } = SPRINGS[name];
  return springResponseOf(stiffness, damping, ms);
}

export function springResponseOf(stiffness: number, damping: number, ms: number): number {
  if (ms <= 0) return 0;
  const t = ms / 1000;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta < 1 - 1e-9) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta <= 1 + 1e-9) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** Peak overshoot of a spring's step response, as a fraction of the travel (0 for ζ ≥ 1). */
export function overshoot(name: SpringName): number {
  const { dampingRatio } = SPRINGS[name];
  if (dampingRatio >= 1) return 0;
  return Math.exp((-Math.PI * dampingRatio) / Math.sqrt(1 - dampingRatio * dampingRatio));
}

/**
 * A spring as a CSS `linear()` easing: `samples` points over its settle time (S2 §2.8 emits 48).
 * Values are rounded to 4 decimals; overshoot above 1 is kept, which `linear()` allows.
 */
export function springLinearEasing(name: SpringName, samples = 48): string {
  const { settleMs } = SPRINGS[name];
  const points: string[] = [];
  for (let i = 0; i < samples; i++) {
    const v = i === samples - 1 ? 1 : springResponse(name, (settleMs * i) / (samples - 1));
    points.push(String(Math.round(v * 10_000) / 10_000));
  }
  return `linear(${points.join(", ")})`;
}

/** Interpolates from → to with an eased progress. */
export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}
