import { describe, expect, it } from "vitest";
import { MarkPaidResponse, Provenance } from "./index.js";

describe("Mark paid provenance", () => {
  it.each(Provenance.options)("inv.i8.mark-paid: accepts the invoice provenance %s", (provenance) => {
    expect(
      MarkPaidResponse.safeParse({
        runSlug: "2026A-r40",
        invoiceId: "INV2-RPLY-TEST",
        invoiceStatus: "MARKED_AS_PAID",
        runState: "EXTRACTING",
        provenance,
      }).success,
    ).toBe(true);
  });
  it("rejects an unknown provenance", () => {
    expect(
      MarkPaidResponse.safeParse({
        runSlug: "2026A-r40",
        invoiceId: "INV2-RPLY-TEST",
        invoiceStatus: "MARKED_AS_PAID",
        runState: "EXTRACTING",
        provenance: "verified",
      }).success,
    ).toBe(false);
  });
});
