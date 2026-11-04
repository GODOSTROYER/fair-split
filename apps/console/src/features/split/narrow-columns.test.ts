// The five-column grid (a container under 1,180 px) keeps the money, its rail and its state (UI gate round 1:
// "retain member, net amount, rail and status at every desktop width"), and fixes Verified kg so no empty band opens
// beside it. AG Grid keeps a stateful attribute a new definition leaves undefined, so the fix clears flex with null.
import { describe, expect, it } from "vitest";
import { NARROW_COLUMNS, NARROW_FIXED, SLIM_COLUMNS } from "./SplitGrid.js";

describe("the narrow grid's columns", () => {
  it("keeps Member, Net, Rail and Status in every set, and fixes Verified kg", () => {
    expect(NARROW_COLUMNS).toEqual(["member", "kg", "net", "rail", "status"]);
    expect(SLIM_COLUMNS).toEqual(["member", "net", "rail", "status"]);
    expect(NARROW_FIXED.kg).toMatchObject({ width: 150, flex: null });
  });
});
