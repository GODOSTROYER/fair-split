import { describe, expect, it } from "vitest";
import { proofProvenanceLine } from "./verify-proof.js";

describe("public verifier provenance", () => {
  it("inv.i8.cli-replay: the payout plate overrides a simulated-rail envelope", () => {
    expect(proofProvenanceLine("simulated_rail", { ok: true, state: "replay", reason: null }, [])).toBe(
      "Simulated PayPal sandbox; provenance: replay (labelled replay of an earlier simulated run).",
    );
  });

  it("inv.i8.cli-replay: replayed items remain labelled even when a plate cannot be checked", () => {
    expect(
      proofProvenanceLine("simulated_rail", { ok: false, reason: "Receivers withheld" }, [
        { provenance: "replay" },
      ]),
    ).toContain("provenance: replay (labelled replay of an earlier simulated run)");
  });

  it("preserves a seeded or simulated envelope when payout evidence is not replayed", () => {
    for (const provenance of ["seeded", "simulated_rail"] as const) {
      expect(proofProvenanceLine(provenance, { ok: true, reason: null }, [])).toBe(
        `Simulated PayPal sandbox; provenance: ${provenance}.`,
      );
    }
  });
});
