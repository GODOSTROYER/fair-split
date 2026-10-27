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
    for (const p of [...info.terminal, ...info.exceptions, ...info.alternates])
      expect(isPhase(id, p)).toBe(true);
    expect(info.terminal.length).toBeGreaterThan(0);
  });

  it("follows S2 §2.9's revised names: MM-5 arms, confirms and disarms; MM-3 lights pairs", () => {
    expect(MOMENTS["MM-5"]).toEqual([
      "blocked",
      "rising",
      "ready",
      "hold-1",
      "armed-1",
      "confirm-1",
      "signed-1",
      "waiting-2",
      "hold-2",
      "armed-2",
      "confirm-2",
      "signed-2",
      "sealed",
      "inked",
      "released-early",
      "disarmed",
      "declined",
      "expired",
      "mismatch",
    ]);
    expect(MOMENTS["MM-3"]).toContain("pairs");
    expect(MOMENTS["MM-3"]).not.toContain("underline");
    expect(happyPath("MM-5")).toEqual([
      "blocked",
      "rising",
      "ready",
      "hold-1",
      "armed-1",
      "signed-1",
      "waiting-2",
      "hold-2",
      "armed-2",
      "signed-2",
      "sealed",
      "inked",
    ]);
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

  it.each(MOMENT_IDS)("%s reaches every phase after the first from some act, exceptions included", (id) => {
    const entered = new Set<string>();
    for (const act of TIMELINES[id].acts) for (const s of act.full) if (s.phase) entered.add(s.phase);
    const [, ...rest] = MOMENTS[id as MomentId];
    for (const phase of rest) expect(entered.has(phase), `${id} never enters ${phase}`).toBe(true);
    expect(happyPath(id as MomentId)[0]).toBe(MOMENTS[id as MomentId][0]);
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

  it("MM-5's console hold arms at 1600 ms with ticks at each quarter; the phone arms at 1200 ms", () => {
    const hold = TIMELINES["MM-5"].acts.find((a) => a.id === "hold-1");
    const ticks = hold?.full.filter((s) => s.feedback === "hold.quarter").map((s) => s.at);
    expect(ticks).toEqual([400, 800, 1200]);
    expect(hold?.full.find((s) => s.feedback === "hold.bottom")).toMatchObject({
      at: 1600,
      phase: "armed-1",
    });
    const phone = TIMELINES["MM-5"].acts.find((a) => a.id === "hold-2");
    expect(phone?.full.filter((s) => s.feedback === "hold.quarter").map((s) => s.at)).toEqual([
      300, 600, 900,
    ]);
    expect(phone?.full.find((s) => s.feedback === "hold.bottom")).toMatchObject({
      at: 1200,
      phase: "armed-2",
    });
  });

  it("MM-5 signs only on approval.signed: no hold, release, disarm or dialog act enters signed-1/2", () => {
    const signing = TIMELINES["MM-5"].acts.filter((a) =>
      a.full.some((s) => s.phase === "signed-1" || s.phase === "signed-2"),
    );
    expect(signing.map((a) => a.id)).toEqual(["signed-1", "signed-2"]);
    for (const id of ["release-1", "release-2"]) {
      const act = TIMELINES["MM-5"].acts.find((a) => a.id === id);
      expect(act, id).toBeDefined();
      expect(
        act?.full.some((s) => s.phase),
        `${id} changes no phase`,
      ).toBe(false);
    }
    const disarm = TIMELINES["MM-5"].acts.find((a) => a.id === "disarm-1");
    expect(disarm?.full[0]).toMatchObject({ phase: "disarmed", target: "slab.travel", to: 0 });
  });

  it("MM-3 lights its four field pairs 120 ms apart from 900 ms, a tick each, then prints the verdict", () => {
    const open = TIMELINES["MM-3"].acts.find((a) => a.id === "open");
    const lit = open?.full.filter((s) => s.target?.startsWith("pair."));
    expect(lit?.map((s) => [s.target, s.at])).toEqual([
      ["pair.serial", 900],
      ["pair.date", 1020],
      ["pair.member", 1140],
      ["pair.net-kg", 1260],
    ]);
    expect(lit?.every((s) => s.feedback === "row.printed")).toBe(true);
    expect(open?.full.find((s) => s.phase === "ready")).toMatchObject({ at: 1380, target: "verdict" });
  });
});

function start(filmTime: string | undefined): number {
  const [m = "0", s = "0"] = (filmTime ?? "9:99").split("–")[0]?.split(":") ?? [];
  return Number(m) * 60 + Number(s);
}
