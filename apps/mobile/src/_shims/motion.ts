/**
 * TEMPORARY SHIM: replace with @fairsplit/motion (`presets`, `timelines`, `feedback-map`; IC-09/IC-10) after WS-DS
 * merges. Pure data, no React Native imports, so the numbers are unit-tested; `ui/motion.ts` adapts them to
 * Reanimated and `platform/feedback` plays the events.
 *
 * S2.0 rule 7: timings come only from here. A numeric literal inside `withTiming(`, `withSpring(` or `animate(` in
 * apps/** fails WS-QA's lint, so screens pass `tween("print")`, `spring("land")` or a `TIMELINE` entry instead.
 */

/* ------------------------------------------------------------------ springs (design §3, S2.8) */

/**
 * Springs are physical: mass 1, k = (2π/d)², c = 4π(1−b)/d, so Motion (web) and Reanimated (native) move alike.
 * `d` is the perceptual duration in seconds and `bounce` the overshoot; damping ratio ζ = 1 − bounce.
 */
export const SPRING_SOURCE = {
  /** Release, a hold let go too early, a disarm. */
  rebound: { d: 0.28, bounce: 0.35 },
  /** PayPal's press, the seal closing, chips landing. */
  land: { d: 0.32, bounce: 0.3 },
  /** A slab rising, layout changes, the split fan's band, a chip lifting in Paminawa. */
  settle: { d: 0.5, bounce: 0.15 },
  /** Sheets, zoom, container transforms. */
  glide: { d: 0.45, bounce: 0 },
  /** The mass-balance needle only: the one spring allowed to bounce above 0.35. */
  needle: { d: 0.9, bounce: 0.6 },
} as const;
export type SpringName = keyof typeof SPRING_SOURCE;

export interface SpringPhysics {
  stiffness: number;
  damping: number;
  mass: 1;
}

/** k and c to one decimal, as the design table prints them (rebound 503.6 / 29.2 …). */
export function springPhysics(name: SpringName): SpringPhysics {
  const { d, bounce } = SPRING_SOURCE[name];
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    stiffness: round1(((2 * Math.PI) / d) ** 2),
    damping: round1((4 * Math.PI * (1 - bounce)) / d),
    mass: 1,
  };
}

export const SPRINGS: Readonly<Record<SpringName, SpringPhysics>> = {
  rebound: springPhysics("rebound"),
  land: springPhysics("land"),
  settle: springPhysics("settle"),
  glide: springPhysics("glide"),
  needle: springPhysics("needle"),
};

/* ------------------------------------------------------------------ tweens (design §3 machine tweens, S2.8) */

/** Cubic-bezier control points; `null` is linear. */
export type Bezier = readonly [number, number, number, number] | null;

const PRESS: Bezier = [0.23, 1, 0.32, 1];
const EASE_OUT: Bezier = [0, 0, 0.58, 1];

/**
 * Machine tweens never scale or bounce. Exits run 20% faster than entrances (rule 5): `digitOut` and `drawerOut`.
 * `reduced` is the 150 ms colour/opacity change that replaces spatial travel under reduced motion; it must run with
 * `ReduceMotion.Never`, or Reanimated would skip it.
 */
export const TWEENS = {
  press: { ms: 90, bezier: PRESS },
  /** Ratchet steps of a hold (the face sinks 2 px a quarter) and the bottom-out. */
  press60: { ms: 60, bezier: PRESS },
  print: { ms: 180, bezier: null },
  band: { ms: 220, bezier: [0.77, 0, 0.175, 1] },
  flight: { ms: 600, bezier: PRESS },
  thread: { ms: 500, bezier: EASE_OUT },
  engrave: { ms: 600, bezier: null },
  arc: { ms: 600, bezier: EASE_OUT },
  digitIn: { ms: 150, bezier: PRESS },
  digitOut: { ms: 120, bezier: PRESS },
  flash: { ms: 600, bezier: null },
  drawerIn: { ms: 420, bezier: [0.32, 0.72, 0, 1] },
  drawerOut: { ms: 320, bezier: [0.32, 0.72, 0, 1] },
  /** Press feedback 100–120 ms; tooltips 150; popovers 200. */
  micro: { ms: 120, bezier: PRESS },
  crossfade: { ms: 200, bezier: null },
  retract: { ms: 200, bezier: PRESS },
  reduced: { ms: 150, bezier: null },
  /** MM-1: the jade flood scales in from the capsule's right bottom. */
  flood: { ms: 140, bezier: EASE_OUT },
  /** MM-1: hollow-fill to ink, stroke 2 → 0. */
  fill: { ms: 120, bezier: null },
  /** MM-1: one 1 px ink ring pulses once on Paminawa. */
  invite: { ms: 400, bezier: EASE_OUT },
  /** Low tier: the seal appears complete with a fade. */
  sealFade: { ms: 200, bezier: null },
} as const satisfies Record<string, { ms: number; bezier: Bezier }>;
export type TweenName = keyof typeof TWEENS;

/** Seal rings engrave one after another (600 ms linear each, staggered 120 ms). */
export const ENGRAVE_STAGGER_MS = 120;

/* ------------------------------------------------------------------ hold-to-commit (S2.7) */

/** 1,600 ms on the console's Approve; 1,200 ms for the Chair's "Pirmahi" on the phone. */
export const HOLD_MS = { console: 1600, phone: 1200 } as const;

/* ------------------------------------------------------------------ timelines (S2.9, ms from the trigger) */

export const TIMELINE = {
  /** MM-1 Bayad na (M-MB-01): a verified `item.updated` SUCCESS for this member's item. */
  "MM-1": {
    press: 0,
    flood: 90,
    fill: 120,
    chime: 180,
    label: 400,
    invite: 900,
    done: 1300,
    /** Opened from a push: the moment plays only within 120 s of the event; later, the end state shows. */
    freshForMs: 120_000,
    /** E2E: `done` within 3 s of the event. */
    assertDoneWithinMs: 3000,
  },
  /** MM-5, the phone's half (M-BD-02). */
  "MM-5": {
    holdMs: HOLD_MS.phone,
    quartersMs: [300, 600, 900] as const,
    /** After the Chair's `approval.signed`: the seal lands (1.03 → 1 on `land`), then amounts turn to ink. */
    sealedAfterMs: 720,
    inkedAfterMs: 960,
    sealOvershoot: 1.03,
  },
  /** MM-7 Tap a peso (M-MB-01), reduced form first. */
  "MM-7": {
    frameMs: 90,
    crossfadeMs: 200,
    tileStaggerMs: 60,
    zoomMax: 2.4,
    /** The Rigid / Segment_Tick haptic fires two-thirds of the way into the zoom. */
    hapticAt: 2 / 3,
  },
  /** "Gipadala na, naghulat sa PayPal": the pending ring animates for 60 s at most, then shows elapsed time. */
  pendingRing: { maxAnimateMs: 60_000 },
  /** A Paminawa chip rises 8 dp (`settle`) and stays lit for 1.2 s when its sentence names it. */
  paminawaChip: { liftDp: 8, litMs: 1200 },
} as const;

/* ------------------------------------------------------------------ feedback map (S2.10) */

/**
 * `feedback.play(event, {index})` is the only way UI makes sound or haptics. Haptics only decorate; they never
 * carry meaning, and the web promises none.
 */
export const FEEDBACK_EVENTS = [
  "row.printed",
  "slip.captured",
  "slab.d1.press",
  "slab.d1.release",
  "slab.d2.commit",
  "duplicate.found",
  "hold.quarter",
  "hold.bottom",
  "bolted.refuse",
  "seal.mismatch",
  "seal.complete",
  "item.paid.member",
  "item.paid.console",
  "invoice.paid",
  "paypal.failure",
  "zoom.commit",
  "webhook.duplicate",
] as const;
export type FeedbackEvent = (typeof FEEDBACK_EVENTS)[number];

/** The three sounds native ships (S2.10 "plays only the sounds marked with a star"). */
export type NativeSound = "chime" | "plunk" | "clack";

export const NATIVE_SOUND: Readonly<Partial<Record<FeedbackEvent, NativeSound>>> = {
  "slab.d2.commit": "plunk",
  "hold.bottom": "plunk",
  "seal.complete": "plunk",
  "bolted.refuse": "clack",
  "seal.mismatch": "clack",
  "item.paid.member": "chime",
};

/* ------------------------------------------------------------------ concurrency (design §3 rule 6) */

/** At most eight concurrent flights, or three on the low tier (≤3.3 GB phones). */
export const MAX_FLIGHTS = { full: 8, low: 3 } as const;
