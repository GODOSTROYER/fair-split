// @fairsplit/motion/native: presets shaped for Reanimated 4. Reanimated is not a dependency here (WS-APP pins
// it with Expo SDK 58), so tweens take its Easing module as an argument.
//
// Reanimated traps (S2 §2.8): the default mass is 4, so always pass mass 1; `duration` or `dampingRatio`
// override stiffness and damping, so never add them; ReduceMotion.System jumps springs to the end, so the
// 150 ms reduced-motion fades pass ReduceMotion.Never.

import { EASE, SPRINGS, type SpringName, TWEENS, type TweenName } from "./presets.js";

export interface NativeSpring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: 1;
}

export function spring(name: SpringName): NativeSpring {
  const p = SPRINGS[name];
  return { stiffness: p.stiffness, damping: p.damping, mass: 1 };
}

export interface TweenParams {
  readonly duration: number;
  readonly bezier: readonly [number, number, number, number];
}

export function tweenParams(name: TweenName): TweenParams {
  const t = TWEENS[name];
  return { duration: t.ms, bezier: EASE[t.ease] };
}

/** The part of Reanimated's `Easing` that tweens need. */
export interface EasingModule<E> {
  bezier(x1: number, y1: number, x2: number, y2: number): E;
}

/** `const tween = makeTween(Easing); withTiming(v, tween("press"))` */
export function makeTween<E>(easing: EasingModule<E>): (name: TweenName) => { duration: number; easing: E } {
  return (name) => {
    const { duration, bezier } = tweenParams(name);
    return { duration, easing: easing.bezier(bezier[0], bezier[1], bezier[2], bezier[3]) };
  };
}

/** S2 §2.8: native is low tier when expo-device reports totalMemory ≤ 3.3e9 bytes (UNVERIFIED until S7). */
export const LOW_TIER_MEMORY_BYTES = 3.3e9;

export function isLowTier(totalMemory: number | null | undefined): boolean {
  return typeof totalMemory === "number" && totalMemory <= LOW_TIER_MEMORY_BYTES;
}
