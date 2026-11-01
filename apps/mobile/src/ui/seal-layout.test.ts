import { describe, expect, it } from "vitest";
import { seal } from "../_shims/seal";
import { sealLayout } from "./seal-layout";

const digest = "a1".repeat(32);

describe("seal geometry during hidden-frame layout", () => {
  it.each([0, -32, Number.NaN, Number.POSITIVE_INFINITY])("defers an unmeasured size %s", (size) => {
    expect(sealLayout(digest, size)).toEqual({ size: 0, rings: [], stroke: 1 });
  });

  it("draws the same seal as soon as a visible frame has a positive size", () => {
    expect(sealLayout(digest, 180)).toEqual({ size: 180, rings: seal(digest, 180), stroke: 1 });
  });
});
