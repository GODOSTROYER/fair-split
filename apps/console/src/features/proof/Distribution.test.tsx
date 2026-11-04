// "Where every dollar went" (ADR-0016): the bar's segments are the run's own figures, jade only for what the
// simulated PayPal confirmed, and nothing is typed.
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

describe("Proof's distribution bar", () => {
  it("reads PayPal-confirmed, cash and kept-for-members from the run's own figures", () => {
    const segments = distribution(figures);
    expect(segments.map((s) => s.kind)).toEqual(["paypal", "cash", "kept"]);
    expect(segments.map((s) => format.money(s.cents))).toEqual(["US$341.74", "US$3,876.43", "US$21.14"]);
    expect(segments[0]?.members).toBe(snapshot.figures.endPaidMembers);
    expect(segments[1]?.members).toBe(snapshot.figures.endCashMembers);
  });

  it("has no jade before the simulated PayPal confirms anything (Proof opens at 0 of 8)", () => {
    const none = { ...figures.tiers, paypal: { members: 0, cents: 0 } };
    expect(distribution({ tiers: none, holds: figures.holds }).some((s) => s.kind === "paypal")).toBe(false);
  });

  it("renders the bar and its legend, each amount as money", () => {
    render(<Distribution figures={figures} amount="US$4,333.50" />);
    const bar = screen.getByTestId("proof-distribution");
    expect(bar.textContent).toContain("Lantern Bay's US$4,333.50, and where every dollar went");
    expect(screen.getByTestId("proof-distribution.paypal").textContent).toContain("simulated sandbox");
    expect(screen.getByTestId("proof-distribution.kept").textContent).toContain("US$21.14");
  });
});
