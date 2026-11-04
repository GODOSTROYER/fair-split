import { describe, expect, it } from "vitest";
import { payoutStatusPresentation } from "../lib/payout-status.js";
import { type StatementLineFacts, statementPlan } from "./plan.js";
import { renderStatement } from "./render.js";

const facts: StatementLineFacts = {
  lineId: "00000000-0000-4000-8000-000000000014",
  memberNo: "M-014",
  lang: "en",
  state: "PAID",
  verifiedG: 1000,
  grade1G: 1000,
  premiumCents: 100,
  bonusCents: 50,
  netCents: 150,
  deductions: [],
  credits: [],
  slipSerials: ["0403"],
  honorific: "Nang Celing",
  payer: "Buyer",
  resolutionNo: "BR-1",
  treasurer: "Analyn",
  coop: "Bulawanon Kakaw",
  fx: { num: 625, den: 10 },
  cashDay: null,
  itemStatus: "SUCCESS",
  itemProvenance: "replay",
};

describe("inv.i8.api-payout-presentation", () => {
  it("labels a waiting PayPal state simulated before an item exists, without replaying the run label", () => {
    const p = payoutStatusPresentation({ state: "LOCKED", itemStatus: null, itemProvenance: null });
    expect(p.statusWord).toContain("simulated PayPal sandbox");
    expect(p.replayed).toBe(false);
  });

  it("preserves console register words for the brand", () => {
    expect(payoutStatusPresentation({ state: "OFF_RAIL_DUE" }, "console").statusWord).toBe("Cash due");
  });

  it.each(["en", "ceb", "fil"] as const)("%s replay item controls status, amount and SMS", (lang) => {
    const p = payoutStatusPresentation(facts, lang);
    expect(p).toMatchObject({
      replayed: true,
      tone: "neutral",
      amountState: "unsettled",
      simulatedLabel: "Simulated PayPal sandbox",
    });
    expect(p.statusWord).toMatch(/^Replayed \(labelled\)/);
    expect(p.statusWord).toContain("earlier simulated PayPal sandbox run");
    const sms = renderStatement(statementPlan({ ...facts, lang })).sms;
    expect(sms.text).toMatch(/Replayed \(labelled\)/);
    expect(sms.text).toContain("earlier simulated PayPal sandbox run");
    expect(sms.text).not.toMatch(/\bpaid\b|Bayad na|bayad na/i);
    expect(sms.fits).toBe(true);
  });

  it.each(["en", "ceb", "fil"] as const)("%s live simulator stays simulated and never replayed", (lang) => {
    const live = { ...facts, itemProvenance: "simulated_rail" as const };
    const p = payoutStatusPresentation(live, lang);
    expect(p).toMatchObject({ replayed: false, tone: "jade", amountState: "landed" });
    expect(p.statusWord).toContain("simulated PayPal sandbox");
    expect(p.statusWord).not.toMatch(/replay/i);
    const sms = renderStatement(statementPlan({ ...live, lang })).sms;
    expect(sms.text).toContain("Simulated PayPal sandbox");
    expect(sms.text).not.toMatch(/replay/i);
    expect(sms.fits).toBe(true);
  });

  it.each(["READY", "HELD", "EXCLUDED", "OFF_RAIL_DUE", "OFF_RAIL_PAID"] as const)(
    "%s has no replayed PayPal status",
    (state) => {
      const f = { ...facts, state, itemStatus: null };
      const p = payoutStatusPresentation(f, "en");
      expect(p.replayed).toBe(false);
      expect(p.statusWord).not.toMatch(/replay|PayPal/i);
      expect(renderStatement(statementPlan(f)).sms.text).not.toMatch(/replay|PayPal/i);
    },
  );
});
