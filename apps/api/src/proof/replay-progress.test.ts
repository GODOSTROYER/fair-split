import { describe, expect, it } from "vitest";
import { foldProgress, progressOf } from "./stream.js";

describe("replayed public progress", () => {
  it("inv.i8.replay-progress: a replay success is visibly labelled with its provenance", () => {
    const progress = progressOf(
      "2026A-r40",
      "SETTLING",
      ["SUCCESS", "PENDING"],
      ["replay", "simulated_rail"],
    );
    expect(progress).toMatchObject({
      provenance: "replay",
      items: { confirmed: 1, replayed: 1 },
      display: expect.stringContaining("Replayed (labelled)"),
    });
  });
  it("inv.i8.replay-progress: folds the item's event provenance without accepting a stale status", () => {
    const state = {
      runState: "SETTLING" as const,
      items: new Map([["r40-M-014", "PENDING" as const]]),
      provenances: new Map([["r40-M-014", "simulated_rail" as const]]),
    };
    expect(
      foldProgress(state, {
        type: "item.updated",
        provenance: "replay",
        payload: { senderItemId: "r40-M-014", to: "SUCCESS" },
      }),
    ).toBe(true);
    expect(state.provenances.get("r40-M-014")).toBe("replay");
    expect(
      foldProgress(state, {
        type: "item.updated",
        provenance: "live",
        payload: { senderItemId: "r40-M-014", to: "PENDING" },
      }),
    ).toBe(false);
    expect(state.provenances.get("r40-M-014")).toBe("replay");
  });
});
