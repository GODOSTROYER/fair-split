import { describe, expect, it } from "vitest";
import { describeContext, describeEvent } from "../data/describe.js";
import { BY_HAND_COPY } from "../features/byhand/copy.js";
import { RATECARD_COPY } from "../features/ratecard/copy.js";
import { READING_COPY } from "../features/reading/copy.js";
import { SEASON_COPY, SEASON_STATE_COPY } from "../features/season/copy.js";
import { provenanceFooter } from "../lib/provenance.js";
import { seedSnapshot } from "../test/world.js";
import { STAGE_NOTICE, stageCaption, TRY_TO_BREAK, whatsReal } from "./copy.js";

describe("seeded console provenance", () => {
  it("inv.i8.seeded-copy: identifies placeholders without claiming a Claude recording", () => {
    expect(SEASON_COPY.draftBy).toBe("Placeholder draft (seed-written)");
    expect(SEASON_COPY.draftNote("29 Oct")).toBe(
      "Line labels: a placeholder written with the seed (no Claude recording in this build). Every amount is the engine's quote, checked by the live policy lattice before anything is sent.",
    );
    expect(SEASON_STATE_COPY.drafted).toMatch(/seed-written/);
    expect(READING_COPY.footer("claude-opus-5-5", "29 Oct")).toMatch(
      /^Seed stand-in, not a Claude recording/,
    );
    expect(stageCaption("29 Oct")).toMatch(/Seed stand-in, not a Claude recording/);
    expect(RATECARD_COPY.readFooter("claude-opus-5-5", 1)).toMatch(/Seed stand-in/);
    expect(BY_HAND_COPY.prompt("0462", "Arnel", "6?.80", "40%")).toMatch(/Seed stand-in/);
  });

  it("inv.i8.seeded-row: log rows never attribute seed output to Claude", () => {
    const snapshot = seedSnapshot();
    const row = describeEvent(
      {
        id: "1",
        at: "2026-11-01T00:00:00.000Z",
        ws: "test",
        runId: snapshot.run.id,
        type: "extract.row",
        provenance: "seeded",
        actor: { kind: "engine", id: "extract-replay", impersonatedBy: null },
        payload: { docId: "A", row: 0, serial: "0425", memberNo: "M-001", fields: {} },
      },
      describeContext(snapshot),
    );
    expect(row?.detail).toContain("Seed stand-in, not a Claude recording");
    expect(row?.detail).not.toMatch(/Read by Claude/);
    expect(provenanceFooter({ kind: "seeded" })).toBe("Seed stand-in, not a Claude recording");
  });

  it("inv.i8.whats-real: claims only served controls and describes synthetic image sources", () => {
    const text = whatsReal({
      rail: "simulator",
      recordedOn: "29 Oct",
      replayPhotos: 12,
      replaySlips: 48,
      earlierPhotos: 54,
      members: 64,
      paypalMembers: 7,
    })
      .flatMap((s) => s.items)
      .join(" ");
    expect(text).not.toMatch(
      /Read a slip live|same recording|showcase run's cash receipts|recorded on 29 Oct/,
    );
    expect(text).toContain("photos A–L are composed in code");
    expect(text).toContain("OpenAI's image model");
    // Round 6: no production wording where a judge reads.
    expect(text).not.toMatch(/Codex-made|hero flats|hero slips|hero-slip/);
    expect(text).toContain("untested against PayPal's own sandbox");
    expect(TRY_TO_BREAK.attempts.join(" ")).not.toMatch(/Claude's draft|insufficient-funds/);
    expect(STAGE_NOTICE.queued(3)).toContain("simulated PayPal sandbox");
  });
});
