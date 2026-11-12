// The five-column grid (a container under 1,180 px) keeps the money, its rail and its state (UI gate round 1:
// "retain member, net amount, rail and status at every desktop width"). Verified kg is a right-aligned number column
// of one fixed width in every set (UI gate round 4: no micro-bars), so no empty band opens beside it.
import { describe, expect, it } from "vitest";
import { minWidthOf, NARROW_COLUMNS, SLIM_COLUMNS } from "./SplitGrid.js";

describe("the narrow grid's columns", () => {
  it("keeps Member, Net, Rail and Status in every set", () => {
    expect(NARROW_COLUMNS).toEqual(["member", "kg", "net", "rail", "status"]);
    expect(SLIM_COLUMNS).toEqual(["member", "net", "rail", "status"]);
  });

  it("measures a set by its fixed widths and its flex columns' floors", () => {
    expect(minWidthOf([{ width: 112 }, { minWidth: 148, flex: 1.5 }])).toBe(112 + 148 + 24);
  });
});
