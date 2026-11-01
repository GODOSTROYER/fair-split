import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StatementDTO } from "../_shims/api-client";
import { canonical, coop, heroLine, heroSlips } from "../_shims/seed";
import { buildDemoStatement } from "../services/demo-fixtures";
import {
  equationTerms,
  feeFigures,
  handwrittenDate,
  heroFigures,
  lineConservation,
  PREMIUM_RULE,
  payKindOf,
  rateLabel,
  ratifiedBeforeFirstSlip,
  receiptBarWeights,
  receiptRows,
  shareFigures,
  slipFigures,
  slipTotal,
  traceFor,
  writtenPesos,
} from "./figures";

const NOW = "2026-10-30T09:12:00+08:00";
const paid = buildDemoStatement({ stage: "paid", now: NOW });
const paidAmounts = paid.amounts;
if (!paidAmounts) throw new Error("Missing paid fixture amounts");

/** Reads a formatted amount back to cents ("−1.09" → −109, "US$4,333.50" → 433350). */
function centsOf(text: string): number {
  const m = /^([−+])?(?:US\$)?([\d,]+)\.(\d{2})$/.exec(text);
  if (!m) throw new Error(`not an amount: ${text}`);
  const v = Number((m[2] ?? "").replace(/,/g, "")) * 100 + Number(m[3]);
  return m[1] === "−" ? -v : v;
}

function withAmounts(base: StatementDTO, amounts: StatementDTO["amounts"]): StatementDTO {
  return { ...base, amounts };
}

describe("the hero line M-014 (register §2): US$64.45 = 43.69 + 21.85 − CBU 1.09", () => {
  it("prints the receipt in reading order from the data layer", () => {
    const rows = receiptRows(paid);
    expect(rows.map((r) => [r.id, r.amount])).toEqual([
      ["premium", "43.69"],
      ["bonus", "21.85"],
      ["ded:R1", "−1.09"],
      ["net", "US$64.45"],
    ]);
    expect(rows[2]).toMatchObject({ kind: "deduction", ruleId: "R1", label: "CBU", cents: -109 });
    expect(rows.at(-1)?.spoken).toBe("sixty-four dollars and forty-five cents");
    expect(rows[2]?.spoken).toBe("minus one dollar and nine cents");
  });

  it("figures come from the DTO, never from literals: change the data and every figure follows", () => {
    const other = withAmounts(paid, {
      premiumCents: 8857,
      bonusCents: 4134,
      deductions: [{ ruleId: "R1", label: "CBU", cents: 207 }],
      credits: [],
      netCents: 12784,
    });
    expect(receiptRows(other).map((r) => r.amount)).toEqual(["88.57", "41.34", "−2.07", "US$127.84"]);
    expect(heroFigures(other, "en", "paypal")?.amount).toBe("US$127.84");
    expect(heroFigures(other, "ceb", "cash")?.amount).toBe("₱7,990.00");
  });

  it("shows about ₱4,028 (floored estimate) under a PayPal amount, in the member's language", () => {
    expect(heroFigures(paid, "ceb", "paypal")).toMatchObject({
      amount: "US$64.45",
      estimate: "mga ₱4,028 (gibanabana)",
      rate: "₱62.50",
    });
    expect(heroFigures(paid, "fil", "paypal")?.estimate).toBe("humigit-kumulang ₱4,028 (tantiya)");
    expect(heroFigures(paid, "en", "paypal")?.spoken).toBe(
      "sixty-four dollars and forty-five cents, about four thousand twenty-eight pesos, estimate",
    );
  });

  it("shows exact cash pesos at the run's recorded rate once the line moves to the bodega", () => {
    const cash = buildDemoStatement({ stage: "cash-due", now: NOW });
    expect(payKindOf(cash, "cash-due")).toBe("cash");
    const hero = heroFigures(cash, "ceb", "cash");
    expect(hero).toMatchObject({ amount: "₱4,028.13", usd: "US$64.45", rate: "₱62.50", estimate: null });
    expect(hero?.spoken).toBe("four thousand twenty-eight pesos and thirteen centavos, cash");
  });

  it("decides the rail from the line, and from a return to the bodega", () => {
    expect(payKindOf(paid)).toBe("paypal");
    expect(payKindOf(paid, "paid")).toBe("paypal");
    expect(payKindOf(paid, "cash-received")).toBe("cash");
    expect(payKindOf({ ...paid, rail: "CASH" }, "checking")).toBe("cash");
  });

  it("words the premium as her share of the co-op's verified kilos, never a per-kg rate (S2.2.1)", () => {
    expect(shareFigures(paid)).toEqual({
      kg: "148.0 kg",
      coopKg: "9,780.6 kg",
      grade1Kg: "148.0 kg",
      allGrade1: true,
    });
    // Check from the register: 2,887.50 × 148.0 / 9,780.6 = 43.69.
    expect(Math.round((canonical.invoice.premiumCents * heroLine.netGrams) / coop.verifiedGrams)).toBe(
      heroLine.premiumCents,
    );
  });

  it("states PayPal's and GCash's published rates as rates (FEE_TABLE), never as deductions", () => {
    const f = feeFigures();
    expect(f.paypal).toBe("3%");
    expect(f.gcash).toBe("1%");
    expect(f.paypalSource.length).toBeGreaterThan(0);
  });

  it("reads her slips as the clerk wrote them, and they add up to her kilos", () => {
    const slip = paid.slips[0];
    if (!slip) throw new Error("the hero line has slips");
    expect(slip.serial).toBe(heroSlips[0]?.serial);
    const first = slipFigures(slip, "ceb");
    expect(first).toEqual({
      serial: "0403",
      kg: "38.45 kg",
      written: "38.45",
      date: "2 Hun 2026",
      provisional: false,
    });
    expect(slipTotal(paid)).toEqual({ grams: 148_000, kg: "148.0 kg", matchesLine: true });
    expect(slipTotal({ ...paid, slips: paid.slips.slice(1) }).matchesLine).toBe(false);
  });

  it("prints a returned multa as the pesos written on the slip", () => {
    expect(writtenPesos(20_000)).toBe("₱200");
    expect(writtenPesos(12_550)).toBe("₱125.50");
    expect(rateLabel(paid)).toBe("₱62.50");
  });
});

describe("inv.i3.member-line: money is conserved on the phone", () => {
  it("the hero line adds up to the cent", () => {
    expect(lineConservation(paid)).toEqual({ ok: true, computedCents: 6445, netCents: 6445 });
  });

  it("inv.i3.member-line.property: a line adds up exactly when net = premium + bonus − deductions + credits", () => {
    const amounts = fc.record({
      premiumCents: fc.nat({ max: 50_000 }),
      bonusCents: fc.nat({ max: 50_000 }),
      deductions: fc.array(fc.nat({ max: 2_000 }), { maxLength: 3 }),
      credits: fc.array(fc.nat({ max: 2_000 }), { maxLength: 2 }),
      drift: fc.integer({ min: -3, max: 3 }),
    });
    fc.assert(
      fc.property(amounts, (a) => {
        const ded = a.deductions.map((cents, i) => ({ ruleId: `R${i + 1}`, label: "x", cents }));
        const cred = a.credits.map((cents, i) => ({
          slip: `04${50 + i}`,
          writtenCentavos: cents * 62,
          cents,
        }));
        const exact =
          a.premiumCents +
          a.bonusCents -
          ded.reduce((s, d) => s + d.cents, 0) +
          cred.reduce((s, c) => s + c.cents, 0);
        const netCents = exact + a.drift;
        const dto = withAmounts(paid, {
          premiumCents: a.premiumCents,
          bonusCents: a.bonusCents,
          deductions: ded,
          credits: cred,
          netCents,
        });
        const c = lineConservation(dto);
        return c?.ok === (a.drift === 0 && netCents >= 0) && c?.computedCents === exact;
      }),
    );
  });

  it("refuses fractional or negative cents", () => {
    expect(lineConservation(withAmounts(paid, { ...paidAmounts, premiumCents: 4369.5 }))?.ok).toBe(false);
    const negative = withAmounts(paid, {
      ...paidAmounts,
      deductions: [{ ruleId: "R1", label: "CBU", cents: -109 }],
      netCents: 6663,
    });
    expect(lineConservation(negative)?.ok).toBe(false);
  });

  it("inv.i1.receipt-figures: every printed amount reads back to exactly its row's cents", () => {
    const amounts = fc.record({
      premiumCents: fc.nat({ max: 10_000_000 }),
      bonusCents: fc.nat({ max: 10_000_000 }),
      ded: fc.nat({ max: 100_000 }),
      cred: fc.nat({ max: 100_000 }),
    });
    fc.assert(
      fc.property(amounts, (a) => {
        const dto = withAmounts(paid, {
          premiumCents: a.premiumCents,
          bonusCents: a.bonusCents,
          deductions: [{ ruleId: "R1", label: "CBU", cents: a.ded }],
          credits: [{ slip: "0458", writtenCentavos: 20_000, cents: a.cred }],
          netCents: a.premiumCents + a.bonusCents - a.ded + a.cred,
        });
        return receiptRows(dto).every((r) => centsOf(r.amount) === r.cents);
      }),
    );
  });
});

describe("MM-7 traces: every amount says where it comes from", () => {
  const withCredit: StatementDTO = {
    ...paid,
    amounts: {
      premiumCents: 3612,
      bonusCents: 1735,
      deductions: [{ ruleId: "R2", label: "Hauling", cents: 146 }],
      credits: [{ slip: "0458", writtenCentavos: 20_000, cents: 320 }],
      netCents: 3612 + 1735 - 146 + 320,
    },
    slips: [...paid.slips, { serial: "0458", netGrams: 20_000, deliveredOn: "2026-07-12", cropUrl: null }],
  };

  it("traces the premium to her share of the co-op's verified kilos and her four slips (S2.2.1)", () => {
    expect(traceFor(paid, "premium", "ceb")).toEqual({
      id: "premium",
      kg: "148.0 kg",
      coopKg: "9,780.6 kg",
      rule: PREMIUM_RULE,
      slips: ["0403", "0419", "0436", "0467"],
    });
  });

  it("traces the bonus to her Grade 1 kilos", () => {
    expect(traceFor(paid, "bonus", "en")).toMatchObject({ grade1Kg: "148.0 kg", allGrade1: true });
  });

  it("traces a deduction to its ratified rule, ratified before her first slip (I2)", () => {
    expect(traceFor(paid, "ded:R1", "ceb")).toEqual({
      id: "ded:R1",
      label: "CBU",
      rule: "R1",
      card: "BR 2026-04",
      ratifiedOn: "14 Mar 2026",
      beforeFirstSlip: true,
      slips: [],
    });
    expect(ratifiedBeforeFirstSlip(paid)).toBe(true);
    expect(
      ratifiedBeforeFirstSlip({ ...paid, rateCard: { ...paid.rateCard, ratifiedAt: "2026-07-01" } }),
    ).toBe(false);
    expect(traceFor(paid, "ded:R9", "ceb")).toBeNull();
  });

  it("traces a returned multa to the pesos written on its slip", () => {
    expect(traceFor(withCredit, "credit:0458", "en")).toEqual({
      id: "credit:0458",
      written: "₱200",
      slip: "0458",
      amount: "US$3.20",
      slips: ["0458"],
    });
    expect(traceFor(withCredit, "credit:0999", "en")).toBeNull();
  });

  it("re-adds the line for the net trace: 43.69 + 21.85 − 1.09 = US$64.45", () => {
    expect(traceFor(paid, "net", "en")).toEqual({
      id: "net",
      terms: [
        { op: null, amount: "43.69" },
        { op: "+", amount: "21.85" },
        { op: "−", amount: "1.09" },
      ],
      total: "US$64.45",
      conserved: true,
      slips: [],
    });
    expect(equationTerms(withCredit).map((t) => `${t.op ?? ""}${t.amount}`)).toEqual([
      "36.12",
      "+17.35",
      "−1.46",
      "+3.20",
    ]);
    const broken = withAmounts(paid, { ...paidAmounts, netCents: 6446 });
    expect(traceFor(broken, "net", "en")).toMatchObject({ conserved: false });
  });

  it("traces the fee note to FEE_TABLE's published rates and the run's rate, never to her line", () => {
    const fees = traceFor(paid, "fees", "en");
    expect(fees).toMatchObject({ id: "fees", paypal: "3%", gcash: "1%", rate: "₱62.50" });
    expect(fees && "sources" in fees ? fees.sources.length : 0).toBe(2);
  });

  it("draws the receipt bar from the line's own cents", () => {
    expect(receiptBarWeights(paid)).toEqual({ premium: 4369, bonus: 2076, deducted: 109, credited: 0 });
    expect(receiptBarWeights(withCredit)).toMatchObject({ deducted: 146, credited: 320 });
  });
});

describe("the slip as the clerk wrote it", () => {
  it("writes the delivery date month first, in the co-op's time", () => {
    expect(handwrittenDate("2026-06-02")).toBe("06/02/2026");
    expect(handwrittenDate("2026-06-30T20:30:00Z")).toBe("07/01/2026");
    expect(handwrittenDate("not a date")).toBe("");
  });
});
