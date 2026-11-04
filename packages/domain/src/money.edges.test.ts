// Tests that kill mutation-testing survivors (handoff T3) in integer-cent arithmetic: the divisor and
// overflow guards, the rounding direction of each conversion, largest-remainder ordering (larger
// remainder first, then the lower member number), and the edges of decimal parsing and printing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertNonNeg,
  assertSafeInt,
  centsToCentavos,
  largestRemainder,
  minorToDecimal,
  mulDivFloor,
  mulDivHalfUp,
  parseDecimalMinor,
  sum,
} from "./money.js";

const FX = { num: 125, den: 2 };
const MAX = Number.MAX_SAFE_INTEGER;

describe("integer money guards, with their exact messages", () => {
  it.each([
    ["a zero divisor", () => mulDivFloor(1, 1, 0), "divisor must be a positive safe integer"],
    ["a negative divisor", () => mulDivFloor(4, 1, -2), "divisor must be a positive safe integer"],
    ["a fractional divisor", () => mulDivFloor(4, 1, 1.5), "divisor must be a positive safe integer"],
    ["a zero divisor (half-up)", () => mulDivHalfUp(1, 1, 0), "divisor must be a positive safe integer"],
    ["a negative divisor (half-up)", () => mulDivHalfUp(4, 1, -2), "divisor must be a positive safe integer"],
    [
      "a fractional divisor (half-up)",
      () => mulDivHalfUp(4, 1, 1.5),
      "divisor must be a positive safe integer",
    ],
    ["a fractional a", () => mulDivFloor(1.5, 1, 1), "a must be a safe integer, got 1.5"],
    ["a negative b", () => mulDivFloor(1, -1, 1), "b must be non-negative, got -1"],
    ["a fractional a (half-up)", () => mulDivHalfUp(1.5, 1, 1), "a must be a safe integer, got 1.5"],
    ["a negative b (half-up)", () => mulDivHalfUp(1, -1, 1), "b must be non-negative, got -1"],
    ["a floor product past 2^53", () => mulDivFloor(MAX, 2, 1), "mulDivFloor overflows a safe integer"],
    ["a half-up product past 2^53", () => mulDivHalfUp(MAX, 2, 1), "mulDivHalfUp overflows a safe integer"],
    ["an unsafe sum", () => sum([MAX, 1]), "sum must be a safe integer, got 9007199254740992"],
    ["an unsafe term", () => sum([0.5]), "amount must be a safe integer, got 0.5"],
    ["a fractional amount", () => assertSafeInt(0.5), "amount must be a safe integer, got 0.5"],
    ["a fractional non-negative", () => assertNonNeg(0.5), "amount must be a safe integer, got 0.5"],
    ["a negative amount", () => assertNonNeg(-1), "amount must be non-negative, got -1"],
    [
      "a fractional total",
      () => largestRemainder(1.5, [{ id: "a", weight: 1 }]),
      "total must be a safe integer, got 1.5",
    ],
    [
      "a negative weight",
      () => largestRemainder(1, [{ id: "M-1", weight: -1 }]),
      "weight of M-1 must be non-negative, got -1",
    ],
    [
      "a duplicate member",
      () =>
        largestRemainder(1, [
          { id: "M-1", weight: 1 },
          { id: "M-1", weight: 1 },
        ]),
      "duplicate id M-1",
    ],
    [
      "money over no weight",
      () => largestRemainder(5, [{ id: "a", weight: 0 }]),
      "cannot split a non-zero total over zero weight",
    ],
    ["printing a fraction", () => minorToDecimal(1.5), "amount must be a safe integer, got 1.5"],
    [
      "printing past 2^53",
      () => minorToDecimal(2 ** 53),
      "amount must be a safe integer, got 9007199254740992",
    ],
  ])("refuses %s", (_label, call, message) => {
    expect(call).toThrow(message);
  });

  it("assertNonNeg also refuses what is not an integer, before the sign", () => {
    expect(() => assertNonNeg(-0.5)).toThrow("amount must be a safe integer, got -0.5");
  });
});

describe("conversions round the way they say", () => {
  it("US cents to centavos: half-up and floor differ on a half centavo", () => {
    expect(centsToCentavos(1, FX, "halfUp")).toBe(63); // 62.5
    expect(centsToCentavos(1, FX, "floor")).toBe(62);
  });

  it("property: centsToCentavos rounds half-up or down exactly as the integer formula says", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
        const exact2 = cents * 125; // twice the centavos (rate 125/2)
        expect(centsToCentavos(cents, FX, "floor")).toBe(Math.floor(exact2 / 2));
        expect(centsToCentavos(cents, FX, "halfUp")).toBe(Math.floor((exact2 + 1) / 2));
      }),
      { numRuns: 200 },
    );
  });
});

describe("largestRemainder: who gets the round-up", () => {
  it("the larger remainder wins over a lower member number", () => {
    const r = largestRemainder(1, [
      { id: "M-001", weight: 1 },
      { id: "M-002", weight: 2 },
    ]);
    expect(r.allocations.map((a) => [a.id, a.amount, a.remainder, a.roundedUp])).toEqual([
      ["M-001", 0, 1n, false],
      ["M-002", 1, 2n, true],
    ]);
  });

  it("among equal remainders the lowest member numbers win, whatever order they come in", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `M-${String(i + 1).padStart(3, "0")}`);
    const weights = [...ids].reverse().map((id) => ({ id, weight: 1 }));
    const r = largestRemainder(5, weights);
    const up = r.allocations.filter((a) => a.roundedUp).map((a) => a.id);
    expect(up.sort()).toEqual(ids.slice(0, 5));
    expect(r.roundUps).toBe(5);
  });

  it("reports each exact remainder numerator, and nothing rounded up on zero weight", () => {
    const r = largestRemainder(10, [
      { id: "a", weight: 2 },
      { id: "b", weight: 5 },
    ]);
    // 10 × 2 / 7 = 2 r 6, 10 × 5 / 7 = 7 r 1
    expect(r.allocations.map((a) => [a.floor, a.remainder])).toEqual([
      [2, 6n],
      [7, 1n],
    ]);
    expect(r.totalWeight).toBe(7);
    const zero = largestRemainder(0, [{ id: "a", weight: 0 }]);
    expect(zero.allocations).toEqual([{ id: "a", amount: 0, floor: 0, remainder: 0n, roundedUp: false }]);
  });

  it("property: a round-up never goes to a smaller remainder than one left out", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 5_000 }), { minLength: 2, maxLength: 30 }),
        (total, ws) => {
          const r = largestRemainder(
            total,
            ws.map((weight, i) => ({ id: `M-${String(i).padStart(3, "0")}`, weight })),
          );
          const up = r.allocations.filter((a) => a.roundedUp);
          const out = r.allocations.filter((a) => !a.roundedUp);
          for (const u of up)
            for (const o of out) {
              expect(u.remainder >= o.remainder).toBe(true);
              if (u.remainder === o.remainder) expect(u.id < o.id).toBe(true);
            }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("decimal text", () => {
  it("parses a value with spaces around it, and prints zero without a sign", () => {
    expect(parseDecimalMinor(" 64.50 ")).toBe(6_450);
    expect(minorToDecimal(0)).toBe("0.00");
    expect(minorToDecimal(-1)).toBe("-0.01");
  });
});
