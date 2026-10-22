import { describe, expect, it } from "vitest";
import { FEEDBACK_EVENTS } from "../src/feedback-map.js";
import {
  happyPath,
  isPhase,
  MOMENT_IDS,
  MOMENT_INFO,
  MOMENTS,
  type MomentId,
  momentId,
} from "../src/moments.js";
import { type MotionMode, stepsFor, TIMELINES } from "../src/timelines.js";

const MODES: MotionMode[] = ["full", "reduced", "low"];

describe("moments catalogue (IC-10)", () => {
  it("lists exactly the seven magic moments and the supporting INVOICE.PAID beat", () => {
    expect([...MOMENT_IDS].sort()).toEqual(["MM-1", "MM-2", "MM-3", "MM-4", "MM-5", "MM-6", "MM-7", "MM-S"]);
  });

  it("keeps S2's BEAT-PAID as an alias of the register's MM-S", () => {
    expect(momentId("BEAT-PAID")).toBe("MM-S");
    expect(momentId("MM-3")).toBe("MM-3");
    expect(momentId("MM-9")).toBeUndefined();
  });

  it.each(MOMENT_IDS)("%s has unique, test-selector-safe phases", (id) => {
    const phases = MOMENTS[id];
    expect(phases.length).toBeGreaterThan(2);
    expect(new Set(phases).size).toBe(phases.length);
    for (const p of phases) expect(p).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it.each(MOMENT_IDS)("%s documents its trigger, screens, reduced-motion and low-tier variants", (id) => {
    const info = MOMENT_INFO[id];
    expect(info.id).toBe(id);
    expect(info.trigger.length).toBeGreaterThan(10);
    expect(info.screens.length).toBeGreaterThan(0);
    for (const screen of info.screens) expect(screen).toMatch(/^[WM]-[A-Z]{2}-\d{2}$/);
    expect(info.reducedMotion.length).toBeGreaterThan(10);
    expect(info.lowTier.length).toBeGreaterThan(5);
    expect(info.assertion.length).toBeGreaterThan(5);
    expect(info.owners.length).toBeGreaterThan(0);
    for (const p of [...info.terminal, ...info.exceptions]) expect(isPhase(id, p)).toBe(true);
    expect(info.terminal.length).toBeGreaterThan(0);
  });

  it("places each moment in the register's film order", () => {
    const order = MOMENT_IDS.filter((id) => MOMENT_INFO[id].filmTime).sort(
      (a, b) => start(MOMENT_INFO[a].filmTime) - start(MOMENT_INFO[b].filmTime),
    );
    expect(order).toEqual(["MM-1", "MM-S", "MM-2", "MM-3", "MM-4", "MM-5", "MM-6", "MM-7"]);
  });
});

describe("timelines", () => {
  it.each(MOMENT_IDS)("%s steps only enter its own phases and fire known feedback", (id) => {
    for (const act of TIMELINES[id].acts) {
      for (const mode of MODES) {
        for (const step of stepsFor(act as never, mode) as readonly { phase?: string; feedback?: string }[]) {
          if (step.phase) expect(isPhase(id, step.phase), `${id}/${act.id}: ${step.phase}`).toBe(true);
          if (step.feedback) expect(FEEDBACK_EVENTS).toContain(step.feedback);
        }
      }
    }
  });

  it.each(MOMENT_IDS)("%s renders the same phases at the same times in full, reduced and low modes", (id) => {
    for (const act of TIMELINES[id].acts) {
      const phasesOf = (mode: MotionMode) =>
        (stepsFor(act as never, mode) as readonly { at: number; phase?: string }[])
          .filter((s) => s.phase)
          .map((s) => `${s.phase}@${s.at}`);
      expect(phasesOf("reduced"), `${id}/${act.id}`).toEqual(phasesOf("full"));
      expect(phasesOf("low"), `${id}/${act.id}`).toEqual(phasesOf("full"));
    }
  });

  it.each(MOMENT_IDS)("%s reaches every happy-path phase after the first from some act", (id) => {
    const entered = new Set<string>();
    for (const act of TIMELINES[id].acts) for (const s of act.full) if (s.phase) entered.add(s.phase);
    const [, ...rest] = happyPath(id as MomentId);
    for (const phase of rest) expect(entered.has(phase), `${id} never enters ${phase}`).toBe(true);
  });

  it.each(MOMENT_IDS)("%s declares an initial value for every target it animates", (id) => {
    const { initial, acts } = TIMELINES[id];
    for (const act of acts) {
      for (const mode of MODES) {
        for (const s of stepsFor(act as never, mode) as readonly { target?: string }[]) {
          if (s.target) expect(initial, `${id}/${act.id}: ${s.target}`).toHaveProperty([s.target]);
        }
      }
    }
  });

  it("reduced-motion steps never travel: no springs on spatial targets", () => {
    const spatial = /inset|travel|edge$|scale$|^shake$|^zoom$|band\.y|crop\.flight|photos\.x|crops\.x/;
    for (const id of MOMENT_IDS) {
      for (const act of TIMELINES[id].acts) {
        if (!act.reduced) continue;
        for (const s of act.reduced as readonly { target?: string; motion?: object }[]) {
          if (!s.target || !spatial.test(s.target) || !s.motion) continue;
          expect("instant" in s.motion, `${id}/${act.id}: ${s.target}`).toBe(true);
        }
      }
    }
  });

  it("MM-1 follows S2's table: press 0, flood 90, fill 120, label 400, invite 900, done 1300", () => {
    const act = TIMELINES["MM-1"].acts[0];
    const phases = act?.full.filter((s) => s.phase).map((s) => [s.phase, s.at]);
    expect(phases).toEqual([
      ["press", 0],
      ["flood", 90],
      ["fill", 120],
      ["label", 400],
      ["invite", 900],
      ["done", 1300],
    ]);
    expect(act?.full.find((s) => s.feedback === "item.paid.member")?.at).toBe(180);
  });

  it("MM-5's console hold commits at 1600 ms with ticks at each quarter", () => {
    const hold = TIMELINES["MM-5"].acts.find((a) => a.id === "hold-1");
    const ticks = hold?.full.filter((s) => s.feedback === "hold.quarter").map((s) => s.at);
    expect(ticks).toEqual([400, 800, 1200]);
    expect(hold?.full.find((s) => s.feedback === "hold.bottom")?.at).toBe(1600);
    const phone = TIMELINES["MM-5"].acts.find((a) => a.id === "hold-2");
    expect(phone?.full.filter((s) => s.feedback === "hold.quarter").map((s) => s.at)).toEqual([
      300, 600, 900,
    ]);
  });
});

function start(filmTime: string | undefined): number {
  const [m = "0", s = "0"] = (filmTime ?? "9:99").split("–")[0]?.split(":") ?? [];
  return Number(m) * 60 + Number(s);
}
