import { describe, expect, it } from "vitest";
import { cubicBezier, overshoot, springLinearEasing, springResponse } from "../src/curves.js";
import { makeTween, spring as nativeSpring, tweenParams } from "../src/native.js";
import { EASE, SPRING_NAMES, SPRING_SPECS, SPRINGS, TWEEN_NAMES, TWEENS } from "../src/presets.js";
import { spring as webSpring, tween as webTween } from "../src/web.js";

// S2 §2.8, the table every renderer must reproduce.
const TABLE = {
  rebound: { k: 503.6, c: 29.2, zeta: 0.65, settleMs: 492 },
  land: { k: 385.5, c: 27.5, zeta: 0.7, settleMs: 527 },
  settle: { k: 157.9, c: 21.4, zeta: 0.85, settleMs: 707 },
  glide: { k: 195.0, c: 27.9, zeta: 1.0, settleMs: 661 },
  needle: { k: 48.7, c: 5.6, zeta: 0.4, settleMs: 2500 },
} as const;

describe("spring presets", () => {
  it.each(SPRING_NAMES)("%s matches the design table (k = (2π/d)², c = 4π(1−b)/d)", (name) => {
    const p = SPRINGS[name];
    const row = TABLE[name];
    expect(p.stiffness).toBeCloseTo(row.k, 1);
    expect(p.damping).toBeCloseTo(row.c, 1);
    expect(p.mass).toBe(1);
    expect(p.dampingRatio).toBeCloseTo(row.zeta, 2);
    expect(Math.abs(p.settleMs - row.settleMs)).toBeLessThanOrEqual(row.settleMs > 1000 ? 10 : 2);
  });

  it("derives ζ = 1 − bounce for every spring", () => {
    for (const name of SPRING_NAMES) {
      expect(SPRINGS[name].dampingRatio).toBeCloseTo(1 - SPRING_SPECS[name].bounce, 2);
    }
  });

  it("only the needle bounces above 0.35", () => {
    const bouncy = SPRING_NAMES.filter((n) => SPRING_SPECS[n].bounce > 0.35);
    expect(bouncy).toEqual(["needle"]);
  });

  it("the needle overshoots by about 25% (2.05% → 1.62% dips to about 1.51%)", () => {
    expect(overshoot("needle")).toBeCloseTo(0.254, 2);
    const dip = 2.05 - (2.05 - 1.62) * (1 + overshoot("needle"));
    expect(dip).toBeCloseTo(1.51, 2);
  });

  // The sweeps below collect the failing samples and assert once: 2,000 separate expect calls were the
  // costliest work in this package, and under load they pushed the test toward its timeout.
  it("each spring stays within 0.1% of its target after its settle time", () => {
    for (const name of SPRING_NAMES) {
      const settle = SPRINGS[name].settleMs;
      const outside: number[] = [];
      for (let t = settle; t < settle + 2000; t += 5) {
        if (!(Math.abs(1 - springResponse(name, t)) <= 0.0010001)) outside.push(t);
      }
      expect(outside, `${name} leaves the 0.1% band at these ms`).toEqual([]);
    }
  });

  it("glide is critically damped and never overshoots", () => {
    const over: number[] = [];
    for (let t = 0; t < 1500; t += 5) if (!(springResponse("glide", t) <= 1)) over.push(t);
    expect(over, "glide passes 1 at these ms").toEqual([]);
  });

  it("emits a 48-point CSS linear() easing that ends on 1", () => {
    const css = springLinearEasing("land");
    const points = css.slice("linear(".length, -1).split(", ").map(Number);
    expect(points).toHaveLength(48);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(Math.max(...points)).toBeGreaterThan(1);
  });
});

describe("platform adapters", () => {
  it("web springs carry mass 1 and unit-appropriate rest deltas", () => {
    expect(webSpring("land")).toMatchObject({ type: "spring", stiffness: 385.5, damping: 27.5, mass: 1 });
    expect(webSpring("land", "unitless").restDelta).toBe(0.001);
  });

  it("native springs never pass duration or dampingRatio (they would override k and c)", () => {
    const s = nativeSpring("settle");
    expect(Object.keys(s).sort()).toEqual(["damping", "mass", "stiffness"]);
    expect(s.mass).toBe(1);
  });

  it("tweens share durations and curves across platforms", () => {
    for (const name of TWEEN_NAMES) {
      expect(webTween(name).duration * 1000).toBeCloseTo(TWEENS[name].ms, 6);
      expect(tweenParams(name).duration).toBe(TWEENS[name].ms);
    }
    const tween = makeTween({ bezier: (a, b, c, d) => [a, b, c, d] });
    expect(tween("press")).toEqual({ duration: 90, easing: [0.23, 1, 0.32, 1] });
  });

  it("exits run 20% faster than entrances (drawer 420 in, 320 out is within that rule)", () => {
    expect(TWEENS.drawerOut.ms).toBeLessThanOrEqual(TWEENS.drawerIn.ms * 0.8);
    expect(TWEENS.digitOut.ms).toBeLessThanOrEqual(TWEENS.digitIn.ms * 0.8);
  });
});

describe("curves", () => {
  it("evaluates cubic-bezier endpoints and linear", () => {
    expect(cubicBezier(EASE.press, 0)).toBe(0);
    expect(cubicBezier(EASE.press, 1)).toBe(1);
    expect(cubicBezier(EASE.linear, 0.37)).toBeCloseTo(0.37, 6);
  });

  it("the press curve front-loads travel: more than 60% done by a quarter of the time", () => {
    expect(cubicBezier(EASE.press, 0.25)).toBeGreaterThan(0.6);
  });

  it("no curve is a pure ease-in (slow start, abrupt end)", () => {
    for (const [name, curve] of Object.entries(EASE)) {
      if (name === "linear" || name === "band") continue;
      const early = cubicBezier(curve, 0.2);
      expect(early, name).toBeGreaterThanOrEqual(0.2);
    }
  });
});
