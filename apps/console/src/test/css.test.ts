import { expect, it } from "vitest";
import { mediaMatches } from "./css.js";

it("evaluates viewport height without treating a short-screen rule as universal", () => {
  expect(mediaMatches("(max-height: 899px)", { width: 1280, height: 800, motion: "full" })).toBe(true);
  expect(mediaMatches("(max-height: 899px)", { width: 1470, height: 956, motion: "full" })).toBe(false);
  expect(mediaMatches("(max-height: 899px)", { width: 1470, motion: "full" })).toBe(false);
});
