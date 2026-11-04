// The five-column grid (a container under 1,180 px) fixes Verified kg and Kaltas, so no empty band opens between
// them. AG Grid keeps a stateful attribute a new definition leaves undefined, so the fix clears flex with null.
import { describe, expect, it } from "vitest";
import { NARROW_COLUMNS, NARROW_FIXED } from "./SplitGrid.js";

describe("the narrow grid's fixed columns", () => {
  it("fixes Verified kg and Kaltas, clearing the default set's flex", () => {
    expect(NARROW_COLUMNS).toEqual(["member", "kg", "kaltas", "net", "status"]);
    expect(NARROW_FIXED.kg).toMatchObject({ width: 150, flex: null });
    expect(NARROW_FIXED.kaltas).toMatchObject({ width: 168, flex: null });
  });
});
