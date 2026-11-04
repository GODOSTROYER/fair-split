// "Play it for me" (S1.6): what the cursor does for each step the run pill names. It drives the steps a
// person would press and stops before both keys.

import { describe, expect, it } from "vitest";
import type { NextStep, StepId } from "../../chrome/next-step.js";
import { AUTOPLAY_COPY, aimAt, isAt, PILL_LINK, planStep } from "./autoplay-plan.js";

function step(id: StepId, to: string): NextStep {
  return { id, text: `Next: ${id}`, actor: "person", screen: "W-JG-01", to };
}

const at = (pathname: string, search = "") => ({ pathname, search });

describe("autoplay's plan", () => {
  it("goes where the pill points by clicking the pill, as a person would", () => {
    const plan = planStep(step("by-hand", "/season/2026-A/by-hand/0462"), at("/judge"));
    expect(plan).toEqual({ kind: "go", to: "/season/2026-A/by-hand/0462", selector: PILL_LINK });
  });

  it("presses the first press slab, the logbook line then the commit, a hold's slab and Rhea's slab", () => {
    expect(planStep(step("mark-paid", "/judge"), at("/judge"))).toEqual({
      kind: "press",
      selectors: ['[data-testid="W-JG-01.markPaid.face"]'],
    });
    const byHand = planStep(
      step("by-hand", "/season/2026-A/by-hand/0462"),
      at("/season/2026-A/by-hand/0462"),
    );
    expect(byHand.kind === "press" && byHand.selectors[0]).toContain("W-TR-04.useLogbook");
    expect(byHand.kind === "press" && byHand.selectors[1]).toContain("W-TR-04.commit.face");
    const hold = planStep(
      step("holds", "/runs/2026A-r37/split?hold=H2"),
      at("/runs/2026A-r37/split", "?hold=H2"),
    );
    expect(hold.kind === "press" && hold.selectors[0]).toContain('[data-testid="W-TR-06"]');
    const rhea = planStep(step("rhea", "/runs/2026A-r37/fanout"), at("/runs/2026A-r37/fanout"));
    expect(rhea.kind === "press" && rhea.selectors[0]).toContain('[data-testid="W-TR-08"]');
  });

  it("watches while the machine reads and while PayPal confirms", () => {
    expect(planStep(step("recording", "/judge"), at("/judge"))).toEqual({ kind: "wait" });
    expect(planStep(step("reading", "/season/2026-A/reading"), at("/season/2026-A/reading")).kind).toBe(
      "wait",
    );
    expect(planStep(step("confirming", "/runs/2026A-r37/fanout"), at("/runs/2026A-r37/fanout")).kind).toBe(
      "wait",
    );
  });

  it("stops before both keys", () => {
    const approve = planStep(step("approve", "/runs/2026A-r37/approve"), at("/runs/2026A-r37/approve"));
    expect(approve).toMatchObject({ kind: "turn", message: AUTOPLAY_COPY.approveTurn });
    const cosign = planStep(step("cosign", "/runs/2026A-r37/approve"), at("/runs/2026A-r37/approve"));
    expect(cosign).toMatchObject({ kind: "turn", message: AUTOPLAY_COPY.cosignTurn });
    expect(AUTOPLAY_COPY.approveTurn).toBe("Your turn: hold to approve");
    expect(AUTOPLAY_COPY.cosignTurn).toBe("Your turn: co-sign as Ernesto");
  });

  it("opens Proof at the end, and hands a declined or paused run back", () => {
    expect(planStep(step("done", "/proof/2026A-r37"), at("/runs/2026A-r37/fanout")).kind).toBe("finish");
    expect(planStep(step("denied", "/runs/2026A-r37/approve"), at("/x")).kind).toBe("turn");
  });

  it("matches a destination's own query and ignores extra keys on the page", () => {
    expect(isAt(at("/runs/r/split", "?hold=H1&member=M-014"), "/runs/r/split?hold=H1")).toBe(true);
    expect(isAt(at("/runs/r/split", "?hold=H2"), "/runs/r/split?hold=H1")).toBe(false);
    expect(isAt(at("/judge"), "/judge")).toBe(true);
  });

  it("aims a little inside a control's left edge, at its middle", () => {
    expect(aimAt({ left: 100, top: 40, width: 300, height: 48 })).toEqual({ x: 128, y: 64 });
    expect(aimAt({ left: 10, top: 10, width: 20, height: 20 })).toEqual({ x: 20, y: 20 });
  });
});
