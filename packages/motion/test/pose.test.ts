import { describe, expect, it } from "vitest";
import { phaseTimes, poseAt, poseOfStudy, STUDIES } from "../src/pose.js";

describe("poseAt: MM-1 Bayad na study", () => {
  const at = (t: number, mode: "full" | "reduced" | "low" = "full") => poseOfStudy("MM-1", t, mode);

  it("waits in pending until the verified SUCCEEDED arrives", () => {
    expect(at(0).phase).toBe("pending");
    expect(at(299).values["capsule.inset"]).toBe(5);
    expect(at(299).values["amount.solid"]).toBe(0);
  });

  it("walks press → flood → fill → label → invite → done on S2's clock", () => {
    const sequence = phaseTimes("MM-1", STUDIES["MM-1"].cues).map((p) => `${p.phase}@${p.at}`);
    expect(sequence).toEqual(["press@300", "flood@390", "fill@420", "label@700", "invite@1200", "done@1600"]);
  });

  it("closes the 5 px inset with the press tween and floods jade from the corner", () => {
    expect(at(345).values["capsule.inset"]).toBeGreaterThan(0);
    expect(at(345).values["capsule.inset"]).toBeLessThan(2);
    expect(at(390).values["capsule.inset"]).toBe(0);
    expect(at(390).values["flood.scale"]).toBe(0);
    expect(at(530).values["flood.scale"]).toBe(1);
    expect(at(1600).values["label.paid"]).toBe(1);
  });

  it("chimes at 180 ms after the event", () => {
    expect(at(479).fired.map((f) => f.event)).not.toContain("item.paid.member");
    expect(at(480).fired).toEqual([{ at: 480, event: "item.paid.member" }]);
  });

  it("reduced motion keeps the phases but drops the travel and the corner flood", () => {
    expect(at(301, "reduced").values["capsule.inset"]).toBe(0);
    expect(at(391, "reduced").values["flood.scale"]).toBe(1);
    expect(at(391, "reduced").values["flood.opacity"]).toBeLessThan(0.2);
    expect(at(1600, "reduced").phase).toBe("done");
  });

  it("the low tier fills the amount instantly", () => {
    expect(at(421, "low").values["amount.solid"]).toBe(1);
    expect(at(421).values["amount.solid"]).toBeLessThan(0.1);
  });
});

describe("poseAt: MM-5 Two keys study", () => {
  const at = (t: number, mode: "full" | "reduced" | "low" = "full") => poseOfStudy("MM-5", t, mode);

  it("starts blocked and rises on the settle spring", () => {
    expect(at(0).phase).toBe("blocked");
    expect(at(0).values["slab.edge"]).toBe(0);
    expect(at(500).phase).toBe("rising");
    expect(at(500).values["slab.edge"]).toBeGreaterThan(4);
    expect(at(1100).phase).toBe("ready");
  });

  it("sinks the face 2 px at each quarter and clunks flush at 1600 ms", () => {
    const start = 1500;
    expect(at(start + 399).values["slab.travel"]).toBe(0);
    expect(at(start + 460).values["slab.travel"]).toBeCloseTo(2, 1);
    expect(at(start + 860).values["slab.travel"]).toBeCloseTo(4, 1);
    expect(at(start + 1260).values["slab.travel"]).toBeCloseTo(6, 1);
    expect(at(start + 1660).values["slab.travel"]).toBeCloseTo(8, 1);
    expect(at(start + 800).values["slab.fill"]).toBeCloseTo(0.5, 2);
    const fired = at(start + 1600).fired.map((f) => f.event);
    expect(fired.filter((e) => e === "hold.quarter")).toHaveLength(3);
    expect(fired).toContain("hold.bottom");
  });

  it("engraves the inner rings for key 1 and the outer rings for key 2", () => {
    const k1 = at(3200 + 840);
    expect(k1.phase).toBe("waiting-2");
    expect([k1.values.ring0, k1.values.ring1, k1.values.ring2]).toEqual([1, 1, 1]);
    expect([k1.values.ring3, k1.values.ring4]).toEqual([0, 0]);
    const k2 = at(6100 + 720);
    expect(k2.phase).toBe("sealed");
    expect([k2.values.ring3, k2.values.ring4]).toEqual([1, 1]);
  });

  it("lands the seal from 1.03 and inks the sheet", () => {
    expect(at(6100 + 720).values["seal.scale"]).toBeCloseTo(1.03, 3);
    expect(at(6100 + 1400).values["seal.scale"]).toBeCloseTo(1, 3);
    expect(at(7600).phase).toBe("inked");
    expect(at(7600).values.inked).toBe(1);
    expect(at(7600).fired.map((f) => f.event)).toContain("seal.complete");
  });

  it("reduced motion shows a stepped bar instead of face travel, and fades the rings", () => {
    const r = at(1500 + 900, "reduced");
    expect(r.values["slab.travel"]).toBe(0);
    expect(r.values["slab.step"]).toBe(0.5);
    const ring = at(3200 + 75, "reduced");
    expect(ring.values.ring0).toBe(1);
    expect(ring.values["ring0.opacity"]).toBeGreaterThan(0);
    expect(ring.values["ring0.opacity"]).toBeLessThan(1);
    expect(at(7600, "reduced").phase).toBe("inked");
  });

  it("an early release springs the face back, retracts the fill and signs nothing", () => {
    const end = poseOfStudy("MM-5-early", 2800);
    expect(end.phase).toBe("released-early");
    expect(end.values["slab.travel"]).toBeCloseTo(0, 1);
    expect(end.values["slab.fill"]).toBeCloseTo(0, 3);
    expect(end.fired.map((f) => f.event)).not.toContain("hold.bottom");
    expect(phaseTimes("MM-5", STUDIES["MM-5-early"].cues).map((p) => p.phase)).not.toContain("signed-1");
  });

  it("rejects an act the moment does not have", () => {
    expect(() => poseAt("MM-5", 0, [{ act: "nope", at: 0 }])).toThrow(/no act/);
  });
});
