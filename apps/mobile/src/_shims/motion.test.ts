import { describe, expect, it } from "vitest";
import { MOMENTS } from "./moments";
import {
  FEEDBACK_EVENTS,
  HOLD_MS,
  NATIVE_SOUND,
  SPRING_SOURCE,
  SPRINGS,
  springPhysics,
  TIMELINE,
  TWEENS,
} from "./motion";

describe("motion presets (design §3, S2.8)", () => {
  it("derives spring physics from duration and bounce, as the design table prints them", () => {
    expect(SPRINGS.rebound).toEqual({ stiffness: 503.6, damping: 29.2, mass: 1 });
    expect(SPRINGS.land).toEqual({ stiffness: 385.5, damping: 27.5, mass: 1 });
    expect(SPRINGS.settle).toEqual({ stiffness: 157.9, damping: 21.4, mass: 1 });
    expect(SPRINGS.glide).toEqual({ stiffness: 195, damping: 27.9, mass: 1 });
    expect(SPRINGS.needle).toEqual({ stiffness: 48.7, damping: 5.6, mass: 1 });
  });

  it("keeps damping ratio ζ = 1 − bounce, and only the needle bounces above 0.35", () => {
    for (const name of Object.keys(SPRING_SOURCE) as (keyof typeof SPRING_SOURCE)[]) {
      const { stiffness, damping } = springPhysics(name);
      const zeta = damping / (2 * Math.sqrt(stiffness));
      expect(zeta).toBeCloseTo(1 - SPRING_SOURCE[name].bounce, 2);
      if (name !== "needle") expect(SPRING_SOURCE[name].bounce).toBeLessThanOrEqual(0.35);
    }
  });

  it("runs exits at least 20% faster than entrances (rule 5)", () => {
    expect(TWEENS.digitOut.ms).toBeLessThanOrEqual(TWEENS.digitIn.ms * 0.8);
    expect(TWEENS.drawerOut.ms).toBeLessThanOrEqual(TWEENS.drawerIn.ms * 0.8);
    expect(TWEENS.microOut.ms).toBeLessThanOrEqual(TWEENS.micro.ms * 0.8);
    expect(TWEENS.reduced.ms).toBe(150);
  });

  it("holds 1,600 ms on the console and 1,200 ms on the phone, with quarter steps at 300, 600 and 900", () => {
    expect(HOLD_MS).toEqual({ console: 1600, phone: 1200 });
    expect(TIMELINE["MM-5"].quartersMs).toEqual([300, 600, 900]);
    expect(TIMELINE["MM-5"].quartersMs.map((q) => q / HOLD_MS.phone)).toEqual([0.25, 0.5, 0.75]);
  });

  it("orders MM-1's beats and finishes inside its 3 s assertion", () => {
    const m = TIMELINE["MM-1"];
    const beats = [m.press, m.flood, m.fill, m.chime, m.label, m.invite, m.done];
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
    expect(m.done).toBeLessThan(m.assertDoneWithinMs);
  });
});

describe("feedback map (S2.10)", () => {
  it("plays native sounds only for starred events", () => {
    for (const e of Object.keys(NATIVE_SOUND)) expect(FEEDBACK_EVENTS).toContain(e);
    expect(NATIVE_SOUND["item.paid.member"]).toBe("chime");
    expect(NATIVE_SOUND["seal.mismatch"]).toBe("clack");
    expect(NATIVE_SOUND["hold.quarter"]).toBeUndefined();
    expect(NATIVE_SOUND["webhook.duplicate"]).toBeUndefined(); // silence is the point
  });
});

describe("moments (IC-10, S2.9)", () => {
  it("names the app's phases exactly as S2.9 does", () => {
    expect(MOMENTS["MM-1"]).toEqual(["pending", "press", "flood", "fill", "label", "invite", "done"]);
    expect(MOMENTS["MM-7"]).toEqual([
      "rest",
      "framed",
      "expanded",
      "zooming",
      "zoomed",
      "tiled",
      "returning",
    ]);
    for (const p of ["hold-2", "armed-2", "confirm-2", "signed-2", "sealed", "released-early", "disarmed"]) {
      expect(MOMENTS["MM-5"]).toContain(p);
    }
  });
});
