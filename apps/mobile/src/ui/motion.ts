/**
 * Reanimated adapters for the motion presets (`_shims/motion.ts`, the @fairsplit/motion shim): screens never write
 * a duration, a stiffness or a curve of their own (S2.0 rule 7).
 *
 *   travel.set(withSpring(0, spring("rebound")));
 *   x.set(withTiming(1, tween("print")));
 *   opacity.set(withTiming(1, reducedFade()));   // the 150 ms reduced-motion change, never skipped
 */
import {
  Easing,
  type EasingFunction,
  type EasingFunctionFactory,
  ReduceMotion,
} from "react-native-reanimated";
import {
  type Bezier,
  SPRINGS,
  type SpringName,
  type SpringPhysics,
  TWEENS,
  type TweenName,
} from "../_shims/motion";

export { HOLD_MS, TIMELINE } from "../_shims/motion";

/** Bezier curves stay factories so Reanimated builds them on the UI thread. */
function easing(b: Bezier): EasingFunction | EasingFunctionFactory {
  return b ? Easing.bezier(b[0], b[1], b[2], b[3]) : Easing.linear;
}

/** `{stiffness, damping, mass: 1}`: never a duration or dampingRatio, which would override the physics (S2.8). */
export function spring(name: SpringName): SpringPhysics & { reduceMotion?: ReduceMotion } {
  return SPRINGS[name];
}

export function tween(name: TweenName, reduceMotion?: ReduceMotion) {
  const t = TWEENS[name];
  return { duration: t.ms, easing: easing(t.bezier), ...(reduceMotion ? { reduceMotion } : {}) };
}

/**
 * The reduced-motion substitute: colour and opacity change over 150 ms. It passes `ReduceMotion.Never` because
 * under `ReduceMotion.System` Reanimated would jump straight to the end (S2.8 "Reanimated traps").
 */
export function reducedFade() {
  return tween("reduced", ReduceMotion.Never);
}

/** Durations for JS-side timers that must line up with a tween (a phase change at the end of a fade). */
export function ms(name: TweenName): number {
  return TWEENS[name].ms;
}
