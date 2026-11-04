// Motion presets (design §3, S2 §2.8). The physical parameters are the source of truth: mass is 1, and the
// duration/bounce pairs are documentation converted with k = (2π/d)² and c = 4π(1−b)/d, so Motion on the web
// and Reanimated on native produce identical motion. Every timing in the product comes from this file.

export type Bezier = readonly [number, number, number, number];

/** Named easing curves. There is no ease-in anywhere (design §3, rule 5). */
export const EASE = {
  /** Slab face travel and the ratchet steps. */
  press: [0.23, 1, 0.32, 1],
  /** The reading band moving to a row. */
  band: [0.77, 0, 0.175, 1],
  /** Drawers and sheets (Base UI starting/ending styles). */
  drawer: [0.32, 0.72, 0, 1],
  /** Every "ease-out" in the design: an exponential-style deceleration from an already-visible start. */
  out: [0.16, 1, 0.3, 1],
  /** Linear, written as a bezier so every curve has one shape. */
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

export type EaseName = keyof typeof EASE;

export interface SpringSpec {
  /** Perceptual duration in seconds (documentation). */
  readonly duration: number;
  /** Bounce, 0 to 1 (documentation). Damping ratio ζ = 1 − bounce. */
  readonly bounce: number;
  readonly use: string;
}

/** Spring presets. People and PayPal use springs; machines never do (design §3, rule 1). */
export const SPRING_SPECS = {
  rebound: { duration: 0.28, bounce: 0.35, use: "Release, or a hold let go too early" },
  land: { duration: 0.32, bounce: 0.3, use: "PayPal's press, the seal closing, chips" },
  settle: { duration: 0.5, bounce: 0.15, use: "A slab rising, layout changes, a card flipping" },
  glide: { duration: 0.45, bounce: 0, use: "Drawers, sheets, zoom, container transforms" },
  needle: {
    duration: 0.9,
    bounce: 0.6,
    use: "The mass-balance needle only; the one spring allowed to bounce above 0.35",
  },
} as const satisfies Record<string, SpringSpec>;

export type SpringName = keyof typeof SPRING_SPECS;
export const SPRING_NAMES = Object.keys(SPRING_SPECS) as SpringName[];

export interface SpringParams {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: 1;
  /** Damping ratio, c / (2√(k·m)). */
  readonly dampingRatio: number;
  /** Time in ms until the response stays within `SETTLE_EPSILON` of the target. */
  readonly settleMs: number;
}

/** "Settles" means staying within 0.1% of the target (S2 §2.8). Tests use it as their timeout. */
export const SETTLE_EPSILON = 0.001;

/** Rounded to 0.1, as the design's table prints k and c. */
function to1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Settle time of a mass-1 spring released from rest at distance 1, from its natural frequency ω₀ (rad/s) and
 * damping ratio ζ. Underdamped springs use the envelope e^(−ζω₀t)/√(1−ζ²); a critically damped spring uses
 * its exact response e^(−ω₀t)(1+ω₀t).
 */
export function settleTimeMs(w0: number, zeta: number, epsilon = SETTLE_EPSILON): number {
  if (zeta < 1) {
    return (1000 * Math.log(1 / (epsilon * Math.sqrt(1 - zeta * zeta)))) / (zeta * w0);
  }
  // Solve e^(−u)(1+u) = ε for u = ω₀t by Newton's method.
  let u = 10;
  for (let i = 0; i < 50; i++) {
    const f = Math.exp(-u) * (1 + u) - epsilon;
    const df = -u * Math.exp(-u);
    u -= f / df;
  }
  return (1000 * u) / w0;
}

function paramsOf(spec: SpringSpec): SpringParams {
  const stiffness = to1(((2 * Math.PI) / spec.duration) ** 2);
  const damping = to1((4 * Math.PI * (1 - spec.bounce)) / spec.duration);
  return {
    stiffness,
    damping,
    mass: 1,
    dampingRatio: damping / (2 * Math.sqrt(stiffness)),
    // From the exact (d, b) pair, so glide stays critically damped rather than ζ = 0.999 after rounding.
    settleMs: settleTimeMs((2 * Math.PI) / spec.duration, 1 - spec.bounce),
  };
}

/** Physical parameters for every spring preset, mass 1. */
export const SPRINGS: Readonly<Record<SpringName, SpringParams>> = Object.freeze(
  Object.fromEntries(SPRING_NAMES.map((n) => [n, paramsOf(SPRING_SPECS[n])])) as Record<
    SpringName,
    SpringParams
  >,
);

export interface TweenSpec {
  readonly ms: number;
  readonly ease: EaseName;
  readonly use: string;
}

/** Machine tweens (no springs, no scaling, no depth) and the human press tweens (design §3, S2 §2.8). */
export const TWEENS = {
  press: { ms: 90, ease: "press", use: "Slab face travel" },
  press60: { ms: 60, ease: "press", use: "Hold ratchet steps and the bottom-out clunk" },
  retract200: { ms: 200, ease: "out", use: "Hold progress retracting after an early release" },
  print: { ms: 180, ease: "linear", use: "Clip wipe, left to right" },
  band: { ms: 220, ease: "band", use: "Reading band moving to a row" },
  lift: { ms: 120, ease: "out", use: "A crop lifting before its flight" },
  flight: { ms: 600, ease: "press", use: "Slip crop along a quadratic curve, control point 40 px up" },
  thread: { ms: 500, ease: "out", use: "Payment thread from 0 to 70% on the 201" },
  threadComplete: { ms: 300, ease: "out", use: "Thread from 70 to 100% on a verified item webhook" },
  engrave: { ms: 600, ease: "linear", use: "One seal ring engraving" },
  arc: { ms: 600, ease: "out", use: "The INVOICE.PAID arc" },
  digitIn: { ms: 150, ease: "out", use: "Changed digits sliding in from 6 px" },
  digitOut: { ms: 120, ease: "out", use: "Changed digits sliding out by 6 px" },
  flash: { ms: 150, ease: "out", use: "Grid cell wash in" },
  flashFade: { ms: 450, ease: "out", use: "Grid cell wash fading" },
  drawerIn: { ms: 420, ease: "drawer", use: "Drawer entering" },
  drawerOut: { ms: 320, ease: "drawer", use: "Drawer leaving (exits run faster than entrances)" },
  flood: { ms: 140, ease: "out", use: "Jade flooding a capsule or stub from its corner" },
  halo: { ms: 520, ease: "out", use: "Jade halo, one beat after the simulated PayPal confirms" },
  fill: { ms: 120, ease: "linear", use: "A hollow amount filling in" },
  crossfade: { ms: 200, ease: "out", use: "Label crossfade" },
  ring: { ms: 240, ease: "out", use: "Confidence ring drawing" },
  invite: { ms: 400, ease: "out", use: "One 1 px ink ring pulsing on Paminawa" },
  converge: { ms: 450, ease: "out", use: "Twin crops converging" },
  pair: { ms: 150, ease: "out", use: "A canary outline and connector on one matching field pair (MM-3)" },
  ink: { ms: 240, ease: "out", use: "Pencil figures turning to ink" },
  microPress: { ms: 110, ease: "out", use: "Press feedback (100–120 ms)" },
  tooltip: { ms: 150, ease: "out", use: "Tooltips" },
  popover: { ms: 200, ease: "out", use: "Popovers" },
  reduced: { ms: 150, ease: "out", use: "Reduced motion: colour and opacity changes" },
  edgesFade: { ms: 120, ease: "out", use: "Reduced motion: slab edges fading" },
  lowFade: { ms: 200, ease: "out", use: "Low tier: a seal appearing complete" },
  shake: { ms: 140, ease: "linear", use: "Bolted refusal: ±3 px in two 70 ms cycles" },
  brighten: { ms: 200, ease: "out", use: "Reduced motion: bolted steel brightening" },
} as const satisfies Record<string, TweenSpec>;

export type TweenName = keyof typeof TWEENS;
export const TWEEN_NAMES = Object.keys(TWEENS) as TweenName[];

/** Other fixed timings named by the design. */
export const TIMING = {
  /** A d3 approval hold on the console. */
  holdConsole: 1600,
  /** The Chair's hold on the phone. */
  holdPhone: 1200,
  /** Hold progress is reported in quarters. */
  holdSteps: 4,
  /** The face sinks this many px per quarter step. */
  holdStepTravel: 2,
  threadStagger: 40,
  engraveStagger: 120,
  /** Paper-prints-itself rows start at least this far apart. */
  rowGap: 180,
  /** Grid wave: rows gain cents 6 ms apart, capped at 380 ms. */
  waveStep: 6,
  waveCap: 380,
  /** The pending ring animates for at most 60 s, then shows elapsed time only. */
  pendingRingMax: 60_000,
  /** At most one row tick per 120 ms. */
  tickThrottle: 120,
  /** At most four scale notes per second. */
  scaleThrottle: 250,
  /** Duplicate-found ticks and paid-chime haptics are 90 ms apart. */
  doubleTap: 90,
  /** MM-3's matching field pairs light in turn, this far apart. */
  pairStagger: 120,
  /** Exits run 20% faster than entrances. */
  exitFactor: 0.8,
} as const;

/** Concurrent flight limits (design §3, rule 6). */
export const FLIGHTS = { full: 8, low: 3 } as const;

/** Slab edge depth in px for each consequence level (design §2.4). */
export const DEPTH = { d1: 3, d2: 5, d3: 8 } as const;
export type Depth = keyof typeof DEPTH;
