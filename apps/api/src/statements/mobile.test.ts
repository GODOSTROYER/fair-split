import { getLine, getMember, getRun } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { mobileFigures, mobileItemStatus, settlementEvidence } from "./mobile.js";
import type { StatementLineFacts } from "./plan.js";

describe("mobile statement projection", () => {
  it.each(["COMPUTED", "READY", "HELD", "EXCLUDED"] as const)(
    "inv.i1.mobile-visibility: %s does not expose any money figure",
    (state) => {
      const line = getLine("M-014");
      if (!line) throw new Error("missing hero line");
      const facts: StatementLineFacts = {
        ...line,
        lineId: getMember("M-014")?.id ?? "",
        memberNo: "M-014",
        lang: "en",
        state,
        honorific: "Celing",
        payer: "Buyer",
        resolutionNo: "BR",
        treasurer: "Analyn",
        coop: "Co-op",
        fx: getRun().fx.centavosPerCent,
        cashDay: null,
        itemStatus: null,
      };
      expect(mobileFigures(facts, 9_780_600)).toEqual({
        hero: null,
        receiptRows: [],
        conservation: null,
        share: { kg: "148.0 kg", coopKg: "9,780.6 kg", grade1Kg: "148.0 kg", allGrade1: true },
      });
    },
  );

  it("inv.i5.mobile-submitted: the snapshot uses a phone-ranked pending status until an event advances it", () => {
    expect(mobileItemStatus("SUBMITTED", false)).toBe("PENDING");
    expect(mobileItemStatus("SUBMITTED", true)).toBe("PENDING");
    expect(mobileItemStatus("SUCCESS", true)).toBe("SUCCESS");
    expect(mobileItemStatus("SUCCESS", false)).toBe("PENDING");
  });

  it("inv.i1.mobile-formats: the server supplies every receipt amount and hero figure", () => {
    const line = getLine("M-014");
    if (!line) throw new Error("missing hero line");
    const figures = mobileFigures(
      {
        lineId: getMember("M-014")?.id ?? "",
        memberNo: "M-014",
        lang: "ceb",
        state: "PAID",
        verifiedG: line.verifiedG,
        grade1G: line.grade1G,
        premiumCents: line.premiumCents,
        bonusCents: line.bonusCents,
        netCents: line.netCents,
        deductions: line.deductions,
        credits: line.credits,
        slipSerials: line.slipSerials,
        honorific: "Nang Celing",
        payer: "Buyer",
        resolutionNo: "BR",
        treasurer: "Analyn",
        coop: "Co-op",
        fx: getRun().fx.centavosPerCent,
        cashDay: null,
        itemStatus: "SUCCESS",
      },
      9_780_600,
    );
    expect(figures.hero?.paypal).toMatchObject({
      kind: "paypal",
      amount: "US$64.45",
      estimate: "mga ₱4,028 (gibanabana)",
      rate: "₱62.50",
    });
    expect(figures.hero?.cash).toMatchObject({ kind: "cash", amount: "₱4,028.13", estimate: null });
    expect(figures.receiptRows.map((r) => r.amount)).toEqual(["43.69", "21.85", "−1.09", "US$64.45"]);
    expect(figures.conservation).toEqual({ ok: true, computedCents: line.netCents, netCents: line.netCents });
    expect(figures.share).toMatchObject({ kg: "148.0 kg", coopKg: "9,780.6 kg", allGrade1: true });
  });

  it("inv.i8.mobile-settlement: only a verified stored webhook with its event ID or labelled replay claims paid", () => {
    expect(settlementEvidence({ source: "post_response", eventId: "fake" }, "simulated_rail")).toBe(false);
    expect(settlementEvidence({ source: "webhook" }, "simulated_rail")).toBe(false);
    expect(
      settlementEvidence({ source: "webhook", eventId: "fake", verified: "self" }, "simulated_rail"),
    ).toBe(true);
    expect(settlementEvidence({ source: "replay" }, "replay")).toBe(true);
    expect(settlementEvidence({ source: "replay" }, "live")).toBe(false);
    expect(settlementEvidence({ source: "webhook", eventId: "historical-live" }, "live")).toBe(false);
  });
});
