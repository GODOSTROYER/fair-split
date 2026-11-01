// A date and its time always agree for a person in Calinan (+08:00), even across midnight UTC.

import { describe, expect, it } from "vitest";
import { davaoDateTime, davaoIsoDate, davaoShort } from "./davao.js";

describe("Davao dates", () => {
  it("rolls the calendar date with the +08:00 clock", () => {
    expect(davaoIsoDate("2026-10-27T21:14:40.000Z")).toBe("2026-10-28");
    expect(davaoShort("2026-10-27T21:14:40.000Z")).toBe("28 Oct, 05:14:40");
    expect(davaoDateTime("2026-10-29T02:13:47.000Z")).toBe("29 Oct 2026, 10:13:47");
    expect(() => davaoIsoDate("not a date")).toThrow(RangeError);
  });
});
