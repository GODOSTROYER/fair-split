// Tests that kill mutation-testing survivors (handoff T3) in engine.ts lines 560-893: the I3
// conservation check clause by clause, pay-time deductions across several loans and advances (each cap
// and the bonus are shared, in ref order), the ruled-mark audit, the money effect a duplicate hold
// reports, and what a line hash covers.
import type { EngineLine, EngineOutput } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { AT, input, member, row, TEST_RULES } from "./__fixtures__/world.js";
import {
  checkRuledMark,
  computeLines,
  conserve,
  holdKey,
  lineCanonical,
  payTimeDeductions,
} from "./engine.js";

const FX = { num: 125, den: 2 };
const line = (out: EngineOutput, no: string) => {
  const l = out.lines.find((x) => x.memberNo === no);
  if (!l) throw new Error(`no line ${no}`);
  return l;
};

describe("inv.i3.conservation: conserve() refuses each broken clause on its own", () => {
  type L = Parameters<typeof conserve>[0][number];
  const l = (over: Partial<L> = {}): L => ({
    premiumCents: 100,
    bonusCents: 50,
    deductionsCents: 10,
    creditsCents: 5,
    netCents: 145,
    rail: "PAYPAL",
    state: "READY",
    ...over,
  });

  it("balances a consistent set", () => {
    expect(conserve([l(), l({ rail: "CASH" }), l({ state: "HELD" })], 300, 150)).toMatchObject({
      balanced: true,
      onRailNetCents: 145,
      offRailNetCents: 145,
      carriedNetCents: 145,
    });
  });

  // Each case breaks one clause and keeps the others true (conserve does not re-add a line itself).
  it.each([
    ["the premium sum is not the premium pool", [l({ netCents: 146 })], 101, 50],
    ["the bonus sum is not the bonus pool", [l({ netCents: 146 })], 100, 51],
    ["net + deductions - credits is not the pool", [l({ netCents: 146 })], 100, 50],
  ] as const)("is unbalanced when %s", (_label, lines, premium, bonus) => {
    expect(conserve(lines, premium, bonus).balanced).toBe(false);
  });
});

describe("pay-time deductions across several loans and advances", () => {
  const base = { cbuPaidUpCentavos: 500_000, loans: [], advances: [] };

  it("the loan cap is shared by every loan, in ref order", () => {
    // bonus 1,000 → loan cap 500; each loan owes 400 (₱250)
    const d = payTimeDeductions(
      {
        ...base,
        loans: [
          { ref: "LN-B", outstandingCentavos: 25_000, authorityToDeduct: true },
          { ref: "LN-A", outstandingCentavos: 25_000, authorityToDeduct: true },
        ],
      },
      1_000,
      TEST_RULES,
      FX,
    );
    expect(d.map((x) => [x.ref, x.amountCents, x.capCents])).toEqual([
      ["LN-A", 400, 500],
      ["LN-B", 100, 500],
    ]);
  });

  it("the advance cap is shared by every advance, in voucher order", () => {
    // bonus 1,000 → advance cap 300
    const d = payTimeDeductions(
      {
        ...base,
        advances: [
          { voucherNo: "CA-2", outstandingCentavos: 25_000 },
          { voucherNo: "CA-1", outstandingCentavos: 25_000 },
        ],
      },
      1_000,
      TEST_RULES,
      FX,
    );
    expect(d.map((x) => [x.ref, x.amountCents])).toEqual([
      ["CA-1", 300],
      ["CA-2", 0],
    ]);
  });

  it("what is left of the bonus is shared: a loan, then an advance, never beyond the bonus", () => {
    const rules = {
      ...TEST_RULES,
      loan: { ...TEST_RULES.loan, capBp: 8_000 },
      advance: { ...TEST_RULES.advance, capBp: 8_000 },
    };
    const d = payTimeDeductions(
      {
        ...base,
        loans: [{ ref: "LN", outstandingCentavos: 1_000_000, authorityToDeduct: true }],
        advances: [{ voucherNo: "CA", outstandingCentavos: 1_000_000 }],
      },
      1_000,
      rules,
      FX,
    );
    expect(d.map((x) => [x.category, x.amountCents])).toEqual([
      ["LOAN", 800],
      ["ADVANCE", 200],
    ]);
  });

  it("nothing owed is no deduction; a CBU that rounds to nothing is none; paid up exactly is done", () => {
    expect(
      payTimeDeductions(
        {
          ...base,
          loans: [{ ref: "LN", outstandingCentavos: 0, authorityToDeduct: true }],
          advances: [{ voucherNo: "CA", outstandingCentavos: 0 }],
        },
        1_000,
        TEST_RULES,
        FX,
      ),
    ).toEqual([]);
    expect(payTimeDeductions({ ...base, cbuPaidUpCentavos: 0 }, 9, TEST_RULES, FX)).toEqual([]); // 5% of 9¢ = 0
    expect(payTimeDeductions({ ...base, cbuPaidUpCentavos: 500_000 }, 2_000, TEST_RULES, FX)).toEqual([]);
    expect(payTimeDeductions({ ...base, cbuPaidUpCentavos: 499_999 }, 2_000, TEST_RULES, FX)).toEqual([]); // ₱0.01 left rounds to 0¢
  });
});

describe("rounding of what is owed and carried", () => {
  it("a loan's centavos round half-up to cents, and the carried rest rounds the deduction half-up back", () => {
    // ₱250.50 = 25,050 centavos = 400.8¢ → 401¢ owed; cap 50% of a 3,001¢ bonus = 1,500¢
    const d = payTimeDeductions(
      {
        cbuPaidUpCentavos: 500_000,
        loans: [{ ref: "LN", outstandingCentavos: 25_050, authorityToDeduct: true }],
        advances: [{ voucherNo: "CA", outstandingCentavos: 25_050 }],
      },
      3_001,
      TEST_RULES,
      FX,
    );
    expect(d.map((x) => [x.category, x.computedCents, x.amountCents, x.carriedCentavos])).toEqual([
      ["LOAN", 401, 401, 0], // 401¢ = 25,062.5 centavos → 25,063, so nothing is carried
      ["ADVANCE", 401, 401, 0],
    ]);
    const partial = payTimeDeductions(
      {
        cbuPaidUpCentavos: 500_000,
        loans: [{ ref: "LN", outstandingCentavos: 25_050, authorityToDeduct: true }],
        advances: [],
      },
      301,
      TEST_RULES,
      FX,
    );
    // cap 150¢ → 9,375 centavos repaid, 15,675 carried
    expect(partial[0]).toMatchObject({ amountCents: 150, carriedCentavos: 15_675 });
    const odd = payTimeDeductions(
      {
        cbuPaidUpCentavos: 500_000,
        loans: [{ ref: "LN", outstandingCentavos: 25_050, authorityToDeduct: true }],
        advances: [],
      },
      303,
      TEST_RULES,
      FX,
    );
    // cap 151¢ → 9,437.5 centavos rounds half-up to 9,438; 15,612 carried
    expect(odd[0]).toMatchObject({ amountCents: 151, carriedCentavos: 15_612 });
  });
});

describe("checkRuledMark", () => {
  const r = { netG: 60_800, station: "PUROK_2" as const };
  const m = {
    loans: [
      { ref: "LN-0", outstandingCentavos: 10_000, authorityToDeduct: false },
      { ref: "ATD-1", outstandingCentavos: 10_000, authorityToDeduct: true },
    ],
    advances: [
      { voucherNo: null, outstandingCentavos: 9_000 },
      { voucherNo: "CA-1", outstandingCentavos: 5_000 },
    ],
  };

  it("names each refusal with its allowed amount", () => {
    expect(checkRuledMark("R3", null, null, r, m, TEST_RULES)).toEqual({
      ok: false,
      allowedCentavos: 0,
      reason: "AMOUNT_UNREADABLE",
    });
    expect(checkRuledMark("R2", 100, null, { ...r, netG: null }, m, TEST_RULES)).toEqual({
      ok: false,
      allowedCentavos: 0,
      reason: "NET_UNKNOWN",
    });
    expect(checkRuledMark("R3", 10_001, null, r, m, TEST_RULES)).toEqual({
      ok: false,
      allowedCentavos: 10_000,
      reason: "OVER_OUTSTANDING",
    });
    expect(checkRuledMark("R3", 10_000, null, r, m, TEST_RULES)).toEqual({
      ok: true,
      allowedCentavos: 10_000,
      reason: null,
    });
    expect(checkRuledMark("R3", 100, "LN-0", r, m, TEST_RULES)).toEqual({
      ok: false,
      allowedCentavos: 0,
      reason: "NO_AUTHORITY_TO_DEDUCT",
    });
    expect(checkRuledMark("R4", 5_000, null, r, m, TEST_RULES)).toEqual({
      ok: true,
      allowedCentavos: 5_000,
      reason: null,
    });
    expect(checkRuledMark("R4", 100, "CA-9", r, m, TEST_RULES)).toEqual({
      ok: false,
      allowedCentavos: 0,
      reason: "NO_VOUCHER",
    });
    expect(
      checkRuledMark("R4", 100, null, r, { ...m, advances: [m.advances[0] as never] }, TEST_RULES),
    ).toEqual({
      ok: false,
      allowedCentavos: 0,
      reason: "NO_VOUCHER",
    });
  });
});

describe("the money effect a duplicate hold reports", () => {
  it("what counting both moves to the holder and from everyone else, and whether both would fit", () => {
    const rows = [
      row("M-001", 100, { serial: "0457" }),
      row("M-001", 100, { serial: "0457", copy: "PINK_DUPLICATE" }),
      row("M-002", 800),
    ];
    const members = [member("M-001"), member("M-002"), member("M-003")];
    const out = computeLines(input(members, rows));
    const once = computeLines(
      input(members, rows, {
        resolutions: [{ holdKey: holdKey.duplicate("0457"), resolution: "COUNT_ONCE", by: "AS", at: AT }],
      }),
    );
    const both = computeLines(
      input(members, rows, {
        resolutions: [
          {
            holdKey: holdKey.duplicate("0457"),
            resolution: "TWO_DELIVERIES",
            reason: "two",
            by: "AS",
            at: AT,
          },
        ],
      }),
    );
    const params = out.holds.find((h) => h.key === holdKey.duplicate("0457"))?.params;
    const bothNet = line(both, "M-001").netCents;
    const onceNet = line(once, "M-001").netCents;
    expect(params).toMatchObject({
      holderNetBothCents: bothNet,
      holderNetOnceCents: onceNet,
      movedCents: bothNet - onceNet,
      othersGainCents: line(once, "M-002").netCents - line(both, "M-002").netCents,
      othersCount: 2,
      shrinkBothBp: 0,
      bothInside: true,
    });
    expect(params?.othersGainCents).toBeGreaterThan(0);
    // The same numbers whatever the other resolutions say about this hold.
    expect(once.holds.find((h) => h.key === holdKey.duplicate("0457"))?.params).toMatchObject({
      holderNetBothCents: bothNet,
      holderNetOnceCents: onceNet,
    });
    const far = computeLines(input(members, [rows[0], rows[1], row("M-002", 900)] as never));
    expect(far.holds.find((h) => h.key === holdKey.duplicate("0457"))?.params.bothInside).toBe(false);
  });

  it("an excluded duplicate reports no effect", () => {
    const rows = [
      row("M-001", 100, { serial: "0458" }),
      row("M-001", 100, { serial: "0458", copy: "PINK_DUPLICATE" }),
    ];
    const ex = computeLines(
      input([member("M-001")], rows, {
        resolutions: [
          { holdKey: holdKey.duplicate("0458"), resolution: "EXCLUDE_LINE", reason: "x", by: "AS", at: AT },
        ],
      }),
    );
    expect(ex.holds.find((h) => h.key === holdKey.duplicate("0458"))?.params).not.toHaveProperty(
      "movedCents",
    );
  });
});

describe("approval and duplicate effects at the edges", () => {
  it("a run whose kilos are still pending is blocked, with no hold to say so", () => {
    const out = computeLines(
      input([member("M-001")], [row("M-001", 1_000), row("M-001", 1, { payableG: null })]),
    );
    expect(out.blockingHoldKeys).toEqual([]);
    expect(out.approvalBlocked).toBe(true);
  });

  it("counting both copies exactly at the tolerance is inside", () => {
    const rows = [
      row("M-001", 10, { serial: "0457" }),
      row("M-001", 10, { serial: "0457", copy: "PINK_DUPLICATE" }),
      row("M-002", 1_000),
    ];
    const out = computeLines(input([member("M-001"), member("M-002")], rows));
    expect(out.holds.find((h) => h.key === holdKey.duplicate("0457"))?.params.bothInside).toBe(true); // +2.0% exactly
  });

  it("the effect of one duplicate keeps the other holds' resolutions", () => {
    const rows = [
      row("M-001", 100, { serial: "0457" }),
      row("M-001", 100, { serial: "0457", copy: "PINK_DUPLICATE" }),
      row("M-002", 100, { serial: "0458" }),
      row("M-002", 100, { serial: "0458", copy: "PINK_DUPLICATE" }),
      row("M-003", 600),
    ];
    const members = [member("M-001"), member("M-002"), member("M-003")];
    const once = (key: string) => ({ holdKey: key, resolution: "COUNT_ONCE" as const, by: "AS", at: AT });
    const out = computeLines(input(members, rows, { resolutions: [once(holdKey.duplicate("0457"))] }));
    const bothFor58 = computeLines(input(members, rows, { resolutions: [once(holdKey.duplicate("0457"))] }));
    const onceFor58 = computeLines(
      input(members, rows, {
        resolutions: [once(holdKey.duplicate("0457")), once(holdKey.duplicate("0458"))],
      }),
    );
    expect(out.holds.find((h) => h.key === holdKey.duplicate("0458"))?.params).toMatchObject({
      holderNetBothCents: line(bothFor58, "M-002").netCents,
      holderNetOnceCents: line(onceFor58, "M-002").netCents,
    });
  });
});

describe("lines and holds in order, and what a line hash covers", () => {
  it("holds raised in another order still come out in kind order", () => {
    const doubtful = row("M-001", 10, {
      pendingFields: [{ fieldId: "f", field: "member_name", score: 0.5 }],
    });
    const out = computeLines(input([member("M-001", { registeredTrees: 1 })], [doubtful]));
    expect(out.holds.map((h) => h.kind)).toEqual(["IMPLAUSIBLE_YIELD", "LOW_CONFIDENCE", "MASS_BALANCE"]);
  });

  it("holds come in kind order, then key order; each line lists its credits by mark and its hold keys sorted", () => {
    const marks = [
      {
        markId: "m2",
        text: "Multa",
        ruleId: "NO_MATCH" as const,
        writtenCentavos: 20_000,
        documentRef: null,
      },
      {
        markId: "m1",
        text: "Multa",
        ruleId: "NO_MATCH" as const,
        writtenCentavos: 40_000,
        documentRef: null,
      },
    ];
    const rows = [
      row("M-001", 10, { serial: "0457", marks }),
      row("M-001", 10, { serial: "0457", copy: "PINK_DUPLICATE" }),
    ];
    const out = computeLines(
      input([member("M-001")], rows, {
        resolutions: [
          { holdKey: holdKey.noRule("m1"), resolution: "RETURN_AS_CREDIT", by: "AS", at: AT },
          { holdKey: holdKey.noRule("m2"), resolution: "RETURN_AS_CREDIT", by: "AS", at: AT },
        ],
      }),
    );
    expect(out.holds.map((h) => h.key)).toEqual([
      holdKey.duplicate("0457"),
      holdKey.noRule("m1"),
      holdKey.noRule("m2"),
      holdKey.massBalance(),
    ]);
    expect(line(out, "M-001").credits.map((c) => c.markId)).toEqual(["m1", "m2"]);
    expect(line(out, "M-001").holdKeys).toEqual([...line(out, "M-001").holdKeys].sort());
    expect(line(out, "M-001").holdKeys).toHaveLength(3);
    const mb = out.holds.find((h) => h.key === holdKey.massBalance());
    expect(mb).toMatchObject({ serials: [], rowIds: [], documentIds: [] });
  });

  it("lineCanonical carries the slips and each credit's mark and amount, nothing else", () => {
    const l = {
      memberNo: "M-001",
      rail: "PAYPAL",
      state: "READY",
      verifiedG: 1,
      grade1G: 1,
      slipSerials: ["0301"],
      premiumCents: 1,
      bonusCents: 1,
      grossCents: 2,
      deductions: [],
      credits: [
        {
          kind: "RETURNED_MARK",
          holdKey: "k",
          markId: "m1",
          serial: "0301",
          text: "t",
          phpCentavos: 6_250,
          amountCents: 100,
        },
      ],
      deductionsCents: 0,
      creditsCents: 100,
      netCents: 102,
      holdKeys: [],
    } as unknown as Omit<EngineLine, "lineSha256">;
    expect(lineCanonical(l, "a".repeat(64))).toMatchObject({
      slipSerials: ["0301"],
      credits: [{ markId: "m1", amountCents: 100 }],
    });
    expect(lineCanonical(l, "a".repeat(64)).credits[0]).toEqual({ markId: "m1", amountCents: 100 });
  });
});
