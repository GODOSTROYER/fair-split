// The prototype keeps every view in the address (G1 sign-off links, Playwright): the seal sheet's size and the
// seal being inspected included, so a flagged seal is a link.

import { describe, expect, it } from "vitest";
import { parseSearch, SHEET_COUNT, SHEET_SIZES } from "./search.js";

describe("prototype URL state", () => {
  it("keeps the seal sheet's size only when it is one S2 names (64, 200 or 320 px)", () => {
    expect(SHEET_SIZES).toEqual([64, 200, 320]);
    for (const px of SHEET_SIZES) {
      expect(parseSearch({ px }).px).toBe(px);
      expect(parseSearch({ px: String(px) }).px).toBe(px);
    }
    for (const px of [0, 96, 128, "big", undefined]) expect(parseSearch({ px }).px).toBeUndefined();
  });

  it("keeps the inspected seal only inside the sheet's 300", () => {
    expect(SHEET_COUNT).toBe(300);
    expect(parseSearch({ seal: 1 }).seal).toBe(1);
    expect(parseSearch({ seal: "300" }).seal).toBe(300);
    for (const seal of [0, 301, 1.5, -2, "x"]) expect(parseSearch({ seal }).seal).toBeUndefined();
  });

  it("still parses the shell's choices and a moment's time", () => {
    expect(
      parseSearch({ theme: "adlaw", motion: "reduced", lang: "fil", t: "1600", study: "MM-5-disarmed" }),
    ).toEqual({ theme: "adlaw", motion: "reduced", lang: "fil", t: 1600, study: "MM-5-disarmed" });
    expect(parseSearch({ theme: "purple", motion: "fast", t: -1 })).toEqual({});
  });
});
