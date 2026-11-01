import { expect, it } from "vitest";
import { continueProof, takeProofContinuation } from "./proof-autoplay.js";

it("continues only the requested Proof run once and stays in memory", () => {
  continueProof("2026A-r38");
  expect(takeProofContinuation("2026A-r37")).toBe(false);
  expect(takeProofContinuation("2026A-r38")).toBe(true);
  expect(takeProofContinuation("2026A-r38")).toBe(false);
});
