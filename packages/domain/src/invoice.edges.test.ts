// Tests that kill mutation-testing survivors (handoff T3) in the canonical invoice (I1): the quote's
// shape, keyed labels, strict dates, and every refusal of canonicalInvoiceCall with its reason.
import type { PolicyCtx } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { invoiceMemo, invoiceNumber, invoiceReference } from "./batch.js";
import {
  autoCancelDate,
  autoCancelRuleArgs,
  canonicalInvoice,
  canonicalInvoiceCall,
  itemLabelProblem,
  parseStrictIsoDate,
} from "./invoice.js";
import { quoteInvoice } from "./quote.js";

const card = testCard();
const quote = quoteInvoice(card, TEST_LOT);
const E: PolicyCtx["expected"] = {
  quote,
  invoiceNumber: invoiceNumber("2026A-r37"),
  reference: invoiceReference(card.sha256),
  memo: invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode),
  businessEmail: "coop-business@sandbox.example",
  payer: { email: "lantern-bay@sandbox.example", businessName: "Lantern Bay Chocolate Co." },
  brandAllowlist: ["lantern-bay@sandbox.example"],
  invoiceId: null,
  invoiceDate: null,
};
const LABELS = ["Premium", "Quality bonus", "Disbursement costs"];

describe("the quote must be the three USD lines, each once", () => {
  it("refuses a fourth key even when the three are there", () => {
    expect(itemLabelProblem([...LABELS, "Premium"], ["PREMIUM", "BONUS", "DISBURSEMENT", "EXTRA"])).toBe(
      "The quote must have one premium, one bonus and one disbursement line",
    );
  });

  it("canonicalInvoice refuses two lines, and three lines with a key twice", () => {
    expect(() => canonicalInvoice({ ...E, quote: { ...quote, items: quote.items.slice(0, 2) } })).toThrow(
      "A quote is three USD lines",
    );
    const twice = [quote.items[0], quote.items[0], quote.items[2]] as typeof quote.items;
    expect(() => canonicalInvoice({ ...E, quote: { ...quote, items: twice } })).toThrow(
      "The quote must have one premium, one bonus and one disbursement line",
    );
  });
});

describe("keyed labels", () => {
  it("refuses keys that are not exactly premium, bonus and disbursement", () => {
    const keyed = { premium: "Premium", bonus: "Quality bonus", disbursment: "Disbursement costs" };
    expect(() => canonicalInvoice(E, keyed as never)).toThrow(
      "The item labels are keyed premium, bonus and disbursement, once each",
    );
    expect(canonicalInvoiceCall("create_invoice", E, keyed as never)).toEqual({
      ok: false,
      reason: "The item labels are keyed premium, bonus and disbursement, once each",
    });
  });

  it("a refused label comes back as the call's reason", () => {
    expect(canonicalInvoiceCall("create_invoice", E, ["Premium", "Bonus 2", "Disbursement"])).toEqual({
      ok: false,
      reason: "Item 2's label must be 1-40 letters, single spaces and ,'()- with no digits",
    });
  });
});

describe("strict dates", () => {
  it.each(["x2026-10-29", "0099-01-01", "2026-02-29", "2026-13-01"])("%s is not a date", (v) => {
    expect(parseStrictIsoDate(v)).toBeNull();
  });

  it("autoCancelDate and autoCancelRuleArgs name what is not a date", () => {
    expect(() => autoCancelDate("2026-02-30")).toThrow("not a YYYY-MM-DD date: 2026-02-30");
    expect(() => autoCancelRuleArgs("INV2-X", "29/10/2026")).toThrow("not a YYYY-MM-DD date: 29/10/2026");
  });
});

describe("canonicalInvoiceCall refuses, never guesses", () => {
  it.each([
    [
      "create_conditional_rules_for_invoice",
      { invoiceDate: "2026-10-29" },
      "There is no invoice to attach the rule to",
    ],
    ["create_conditional_rules_for_invoice", { invoiceId: "INV2-X" }, "The invoice's date is not known yet"],
    ["send_invoice", {}, "There is no invoice to send"],
    ["delete_invoice", { invoiceId: "INV2-X" }, "delete_invoice is not an invoice call"],
  ] as const)("%s with %j", (method, over, reason) => {
    expect(canonicalInvoiceCall(method, { ...E, ...over })).toEqual({ ok: false, reason });
  });
});
