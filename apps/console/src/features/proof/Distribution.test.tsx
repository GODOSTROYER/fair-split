// "Where every dollar went" (ADR-0016): the bar's segments are the run's own figures and they add up to Lantern
// Bay's invoice, cent for cent; jade only for what the simulated PayPal confirmed, and nothing is typed.
import { getSnapshot } from "@fairsplit/api-client/seed";
import type { MemberLineState } from "@fairsplit/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { format } from "../../lib/format.js";
import { Distribution, distribution } from "./Distribution.js";
import { deriveFigures } from "./metrics.js";
import { ledgerFacts, mergeItems } from "./model.js";

const snapshot = getSnapshot();
const bundle = snapshot.proof;
const figures = deriveFigures({
  bundle,
  items: mergeItems(bundle.batch.items),
  lineStates: snapshot.run.lineStates as Readonly<Record<string, MemberLineState>>,
  facts: ledgerFacts(bundle.ledger),
  holds: snapshot.holds,
  seeded: snapshot.figures,
});
const sum = (segments: readonly { readonly cents: number }[]) => segments.reduce((n, s) => n + s.cents, 0);

describe("Proof's distribution bar", () => {
  it("reconciles to the invoice: PayPal-confirmed, cash, ruled deductions and disbursement costs", () => {
    const segments = distribution(bundle, figures);
    expect(segments.map((s) => s.kind)).toEqual(["paypal", "cash", "deductions", "disbursement"]);
    expect(segments.map((s) => format.money(s.cents))).toEqual([
      "US$341.74",
      "US$3,876.43",
      "US$55.33",
      "US$60.00",
    ]);
    expect(sum(segments)).toBe(bundle.invoice.amountCents);
    expect(segments[0]?.members).toBe(snapshot.figures.endPaidMembers);
    expect(segments[1]?.members).toBe(snapshot.figures.endCashMembers);
    // Deductions are the rate card's, net of the credits it returned; disbursement is the invoice beyond the pool.
    expect(segments[2]?.cents).toBe(snapshot.figures.deductionsCents - snapshot.figures.creditsCents);
    expect(segments[3]?.cents).toBe(snapshot.figures.disbursementCents);
  });

  it("still adds up to the invoice with nothing confirmed yet, and has no jade (Proof opens at 0 of 8)", () => {
    const tiers = {
      ...figures.tiers,
      paypal: { members: 0, cents: 0 },
      due: {
        ...figures.tiers.due,
        paypal: { members: figures.tiers.paypal.members, cents: figures.tiers.paypal.cents },
      },
    };
    const segments = distribution(bundle, { tiers });
    expect(segments.some((s) => s.kind === "paypal")).toBe(false);
    expect(segments.map((s) => s.kind)).toContain("flight");
    expect(sum(segments)).toBe(bundle.invoice.amountCents);
  });

  it("renders the bar, its legend and the holds as a note inside the members' share, never as a segment", () => {
    render(<Distribution bundle={bundle} figures={figures} amount="US$4,333.50" />);
    const bar = screen.getByTestId("proof-distribution");
    expect(bar.getAttribute("aria-label")).toBe("Where US$4,333.50 went");
    // A legend row reads swatch · name · count · amount; the PayPal money carries the card's one micro-tag, which a
    // screen reader hears in full (round 4: its word is "Simulated").
    expect(screen.getByTestId("proof-distribution.paypal").textContent).toBe(
      "PayPal, confirmedSimulatedSimulated PayPal sandbox7US$341.74",
    );
    // The axis runs to the next US$500 past the invoice, a tick every US$1,000.
    expect([...bar.querySelectorAll(".pf-dist__tick")].map((t) => t.textContent)).toEqual([
      "0",
      "1k",
      "2k",
      "3k",
      "4k",
    ]);
    expect(screen.getByTestId("proof-distribution.disbursement").textContent).toContain("US$60.00");
    expect(screen.queryByTestId("proof-distribution.kept")).toBeNull();
    expect(screen.getByTestId("proof-distribution.holds").textContent).toContain("US$21.14");
  });
});
