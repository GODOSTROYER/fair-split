import { describe, expect, it } from "vitest";
import { firstView } from "../../data/run-view.js";
import { seedSnapshot } from "../../test/world.js";
import { invoiceTitle } from "./funding.js";

const snapshot = seedSnapshot();
describe("the invoice identifier", () => {
  it("shows Draft invoice until the session's own invoice number exists", () => {
    const view = firstView(snapshot);
    expect(invoiceTitle(snapshot, { ...view, invoice: { ...view.invoice, number: "" } }, true)).toBe(
      "Draft invoice",
    );
    expect(
      invoiceTitle(snapshot, { ...view, invoice: { ...view.invoice, number: "FS-2026A-r99" } }, true),
    ).toBe("Invoice FS-2026A-r99");
  });
  it("labels the seed's identifier on the showcase", () => {
    expect(invoiceTitle(snapshot, firstView(snapshot), false)).toBe(
      `Invoice ${snapshot.run.invoice.invoiceNumber} (seeded sample)`,
    );
  });
});
