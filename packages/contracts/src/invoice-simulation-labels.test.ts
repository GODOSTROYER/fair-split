import { describe, expect, it } from "vitest";
import { INVOICE_STATUS_LABELS, LANGS } from "./index.js";

describe("invoice status provenance", () => {
  it.each(LANGS)("inv.i8.invoice-label.%s: marked paid names the simulated PayPal sandbox", (lang) => {
    expect(INVOICE_STATUS_LABELS.MARKED_AS_PAID[lang]).toContain("simulated PayPal sandbox");
  });
});
