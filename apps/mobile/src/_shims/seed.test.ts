import { describe, expect, it } from "vitest";
import { format } from "./domain";
import { batchItems, batchTotalCents, canonical, fx, heroLine, namedMembers } from "./seed";

describe("canonical figures (register §2): money is conserved", () => {
  it("inv.i3.invoice: the invoice is premium + bonus + disbursement, and the pool is premium + bonus", () => {
    const i = canonical.invoice;
    expect(i.premiumCents + i.bonusCents + i.disbursementCents).toBe(i.totalCents);
    expect(i.premiumCents + i.bonusCents).toBe(canonical.lines.grossCents);
    expect(format.usd(i.totalCents)).toBe("US$4,333.50");
  });

  it("inv.i3.lines: gross − ruled deductions + credits = net = PayPal + cash", () => {
    const l = canonical.lines;
    expect(l.grossCents - l.deductionsCents + l.creditsCents).toBe(l.netCents);
    expect(l.paypal.cents + l.cash.cents).toBe(l.netCents);
    expect(l.paypal.members + l.cash.members).toBe(l.count);
    expect(format.usd(l.netCents)).toBe("US$4,218.17");
  });

  it("inv.i3.batch: the eight PayPal items are the batch, US$368.39", () => {
    expect(batchItems).toHaveLength(canonical.lines.paypal.members);
    expect(batchTotalCents).toBe(canonical.lines.paypal.cents);
    const paypal = namedMembers.filter((m) => m.rail !== "CASH");
    expect(paypal.reduce((s, m) => s + m.netCents, 0)).toBe(batchTotalCents);
  });

  it("inv.i3.end-state: the parked item moves to cash without a cent lost", () => {
    const rhea = namedMembers.find((m) => m.memberNo === "M-031");
    const e = canonical.endState;
    expect(e.paypal.cents).toBe(canonical.lines.paypal.cents - (rhea?.netCents ?? 0));
    expect(e.cash.cents).toBe(canonical.lines.cash.cents + (rhea?.netCents ?? 0));
    expect(e.paypal.members + e.cash.members).toBe(canonical.lines.count);
    // Proof's "7 of 64 members, 8.1% of value".
    expect(Math.round((e.paypal.cents / canonical.lines.netCents) * 1000) / 10).toBe(8.1);
  });

  it("redirects US$21.14: the duplicate slip and the returned multa", () => {
    const r = canonical.redirected;
    expect(r.duplicateSlipCents + r.multaReturnedCents).toBe(r.totalCents);
    expect(r.multaReturnedCents).toBe(canonical.lines.creditsCents);
  });

  it("derives the hero line from the share of verified kilos (S2.2.1 member wording)", () => {
    const share = (pool: number, grams: number, of: number) => Math.round((pool * grams) / of);
    expect(share(canonical.invoice.premiumCents, heroLine.netGrams, canonical.kilos.verifiedGrams)).toBe(
      heroLine.premiumCents,
    );
    expect(
      share(canonical.invoice.bonusCents, heroLine.grade1Grams, canonical.kilos.verifiedGrade1Grams),
    ).toBe(heroLine.bonusCents);
    expect(heroLine.premiumCents + heroLine.bonusCents - 109).toBe(heroLine.netCents);
  });

  it("gives Merlyn exactly ₱7,990.00 at the run's rate, and Nang Celing about ₱4,028", () => {
    const merlyn = namedMembers.find((m) => m.memberNo === "M-053");
    expect(format.cashPesos(merlyn?.netCents ?? 0, fx.phpPerUsd)).toBe("₱7,990.00");
    expect(format.peso(heroLine.netCents, fx.phpPerUsd)).toBe("₱4,028");
  });

  it("keeps the published and production payout fees inside the US$60 disbursement line", () => {
    const f = canonical.fees;
    expect(f.publishedUsPerItemCents * batchItems.length).toBe(f.publishedUsTotalCents);
    expect(Math.round((canonical.lines.paypal.cents * f.productionPhBp) / 10000)).toBe(f.productionPhCents);
    expect(f.productionPhCents).toBeLessThan(canonical.invoice.disbursementCents);
  });
});
