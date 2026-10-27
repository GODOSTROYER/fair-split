// The prototype's copy comes from @fairsplit/i18n with every figure filled in from the fixture.

import { describe, expect, it } from "vitest";
import { rateCardRules } from "./content.js";

describe("prototype copy", () => {
  it("the bolted plate prints Schedule A with BR 2026-04's own terms", () => {
    expect(rateCardRules()).toEqual([
      { id: "R0", text: "Premium is paid by verified kilos and is never deducted." },
      { id: "R1", text: "CBU: 5% of the bonus until ₱5,000 is paid up." },
      { id: "R2", text: "Hauling: ₱1.50 a kg for purok pickups." },
      { id: "R3", text: "Loan: only with a signed Authority to Deduct, up to 50% of the bonus." },
      { id: "R4", text: "Advance: only with a voucher, up to 30% of the bonus." },
    ]);
  });
});
