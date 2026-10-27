import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertSafeInt,
  bpFloor,
  bpHalfUp,
  centavosToCents,
  centsToCentavos,
  largestRemainder,
  minorToDecimal,
  mulDivFloor,
  mulDivHalfUp,
  parseDecimalMinor,
  sum,
} from "./money.js";

const FX = { num: 125, den: 2 };

describe("integer money", () => {
  it("mulDivFloor and mulDivHalfUp are exact", () => {
    expect(mulDivFloor(7, 3, 2)).toBe(10);
    expect(mulDivHalfUp(7, 3, 2)).toBe(11);
    expect(mulDivHalfUp(5, 1, 2)).toBe(3);
    expect(mulDivHalfUp(4, 1, 3)).toBe(1);
    expect(mulDivFloor(9_007_199_254, 1_000_000, 1_000_000)).toBe(9_007_199_254);
  });

  it("rejects non-integers, negatives and zero divisors", () => {
    expect(() => mulDivFloor(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivHalfUp(-1, 1, 1)).toThrow(RangeError);
    expect(() => mulDivFloor(1, 1, 0)).toThrow(RangeError);
    expect(() => assertSafeInt(2 ** 60)).toThrow(RangeError);
  });

  it("deductions round half-up per component, caps round down", () => {
    expect(bpHalfUp(2185, 500)).toBe(109); // 109.25
    expect(bpHalfUp(1897, 500)).toBe(95); // 94.85
    expect(bpHalfUp(1299, 500)).toBe(65); // 64.95
    expect(bpFloor(1181, 5000)).toBe(590); // 590.5
  });

  it("converts pesos at ₱62.50 per US$", () => {
    expect(centavosToCents(20_000, FX, "halfUp")).toBe(320); // ₱200 → US$3.20
    expect(centavosToCents(40_000, FX, "halfUp")).toBe(640); // ₱400 → US$6.40
    expect(centsToCentavos(50, FX, "halfUp")).toBe(3_125); // US$0.50 → ₱31.25
    expect(centavosToCents(100, FX, "floor")).toBe(1);
    expect(centavosToCents(100, FX, "halfUp")).toBe(2);
  });

  it("sums safely", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });

  it("parses and prints decimal money without floats", () => {
    expect(parseDecimalMinor("2887.50")).toBe(288_750);
    expect(parseDecimalMinor("64.5")).toBe(6_450);
    expect(parseDecimalMinor("64")).toBe(6_400);
    expect(parseDecimalMinor("64.555")).toBeNull();
    expect(parseDecimalMinor("-1")).toBeNull();
    expect(minorToDecimal(288_750)).toBe("2887.50");
    expect(minorToDecimal(-109)).toBe("-1.09");
    expect(minorToDecimal(5)).toBe("0.05");
  });
});

describe("largest remainder", () => {
  it("splits exactly and gives ties to the lower member number", () => {
    const r = largestRemainder(10, [
      { id: "M-002", weight: 1 },
      { id: "M-001", weight: 1 },
      { id: "M-003", weight: 1 },
    ]);
    const by = Object.fromEntries(r.allocations.map((a) => [a.id, a.amount]));
    expect(by).toEqual({ "M-001": 4, "M-002": 3, "M-003": 3 });
    expect(r.roundUps).toBe(1);
  });

  it("matches the canonical hero premium (148.0 kg of 9,780.6 kg of a US$2,887.50 pool)", () => {
    const r = largestRemainder(288_750, [
      { id: "M-014", weight: 148_000 },
      { id: "REST", weight: 9_632_600 },
    ]);
    const hero = r.allocations.find((a) => a.id === "M-014");
    expect(hero?.floor).toBe(4369);
  });

  it("handles zero weights and refuses to split money over nothing", () => {
    expect(largestRemainder(0, [{ id: "a", weight: 0 }]).allocations[0]?.amount).toBe(0);
    expect(() => largestRemainder(5, [{ id: "a", weight: 0 }])).toThrow(RangeError);
    expect(() =>
      largestRemainder(5, [
        { id: "a", weight: 1 },
        { id: "a", weight: 1 },
      ]),
    ).toThrow();
  });

  it("property: shares sum to the total and each is the floor or ceiling of its exact share", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.array(fc.integer({ min: 0, max: 400_000 }), { minLength: 1, maxLength: 70 }),
        (total, ws) => {
          fc.pre(ws.some((w) => w > 0));
          const weights = ws.map((w, i) => ({ id: `M-${String(i).padStart(3, "0")}`, weight: w }));
          const r = largestRemainder(total, weights);
          const W = BigInt(ws.reduce((s, w) => s + w, 0));
          let s = 0;
          for (const a of r.allocations) {
            const w = BigInt(weights.find((x) => x.id === a.id)?.weight ?? 0);
            const floor = Number((BigInt(total) * w) / W);
            expect([floor, floor + 1]).toContain(a.amount);
            if (w === 0n) expect(a.amount).toBe(0);
            s += a.amount;
          }
          expect(s).toBe(total);
        },
      ),
      { numRuns: 300 },
    );
  });
});
