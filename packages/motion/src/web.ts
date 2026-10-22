// @fairsplit/motion/web: presets shaped for Motion 14 (motion/react) and plain CSS. There is no Motion import
// here, so the package stays dependency-free; the objects match Motion's transition options.

import { EASE, type EaseName, SPRINGS, type SpringName, TWEENS, type TweenName } from "./presets.js";

export interface WebSpring {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: 1;
  readonly restDelta: number;
  readonly restSpeed: number;
}

export interface WebTween {
  readonly duration: number;
  readonly ease: readonly [number, number, number, number] | "linear";
}

/** A spring for Motion. Use `unitless` for scale and opacity, where a 0.1 rest delta would be visible. */
export function spring(name: SpringName, unit: "px" | "unitless" = "px"): WebSpring {
  const p = SPRINGS[name];
  return {
    type: "spring",
    stiffness: p.stiffness,
    damping: p.damping,
    mass: 1,
    restDelta: unit === "px" ? 0.1 : 0.001,
    restSpeed: 1,
  };
}

/** A tween for Motion: duration in seconds and a cubic-bezier array. */
export function tween(name: TweenName): WebTween {
  const t = TWEENS[name];
  return timed(t.ms, t.ease);
}

/** A tween of a computed length on a named curve. */
export function timed(ms: number, ease: EaseName = "out"): WebTween {
  return { duration: ms / 1000, ease: ease === "linear" ? "linear" : EASE[ease] };
}

export function cssEase(name: EaseName): string {
  const [a, b, c, d] = EASE[name];
  return name === "linear" ? "linear" : `cubic-bezier(${a}, ${b}, ${c}, ${d})`;
}

/** True when the viewer asked the system to reduce motion. */
export function prefersReducedMotion(
  win: Pick<Window, "matchMedia"> | undefined = globalThis.window,
): boolean {
  try {
    return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

export type MotionTier = "full" | "low";

interface NavigatorHints {
  readonly deviceMemory?: number;
  readonly hardwareConcurrency?: number;
}

/** S2 §2.8: the web is low tier when deviceMemory ≤ 4 and hardwareConcurrency ≤ 4. */
export function motionTier(
  nav: NavigatorHints | undefined = globalThis.navigator as NavigatorHints,
): MotionTier {
  const memory = nav?.deviceMemory;
  const cores = nav?.hardwareConcurrency;
  if (memory !== undefined && cores !== undefined && memory <= 4 && cores <= 4) return "low";
  return "full";
}

/**
 * Runs a theme switch with every transition off (design §3, rule 6): inject `*{transition:none!important}`,
 * apply the change, force a reflow, and remove the rule on the next frame.
 */
export function withoutTransitions(apply: () => void, doc: Document | undefined = globalThis.document): void {
  if (!doc) {
    apply();
    return;
  }
  const style = doc.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  doc.head.appendChild(style);
  apply();
  void doc.body?.offsetHeight;
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => style.remove());
  else style.remove();
}
