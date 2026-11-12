import { describe, expect, it } from "vitest";
import { firstView } from "../../../data/run-view.js";
import { seedSnapshot } from "../../../test/world.js";
import { FANOUT } from "./copy.js";
import { cashDayForRun, runAccess, showcaseHref } from "./run-data.js";

const snapshot = seedSnapshot();

describe("a run belongs to its visit", () => {
  it("holds all figures while the saved visit resumes", () => {
    expect(runAccess("2026A-r99", { status: "resuming", session: null, error: null }, snapshot)).toBe(
      "pending",
    );
  });
  it("allows only the active visit or the explicitly seeded showcase", () => {
    expect(runAccess("2026A-r99", { status: "none", session: null, error: null }, snapshot)).toBe("missing");
    expect(runAccess(snapshot.run.runSlug, { status: "none", session: null, error: null }, snapshot)).toBe(
      "allowed",
    );
  });
  it("opens the seeded showcase inside a session too, and links to the same screen of it", () => {
    const session = { sessionId: "s", runId: "r", runSlug: "2026A-r4", expiresAt: "" } as never;
    expect(runAccess(snapshot.run.runSlug, { status: "active", session, error: null }, snapshot)).toBe(
      "allowed",
    );
    expect(runAccess("2026A-r99", { status: "active", session, error: null }, snapshot)).toBe("missing");
    expect(showcaseHref("/runs/2026A-r99/approve", "2026A-r99", snapshot)).toBe(
      `/runs/${snapshot.run.runSlug}/approve`,
    );
    expect(showcaseHref("/elsewhere", "2026A-r99", snapshot)).toBe("/judge");
  });
});

describe("cash day follows the run", () => {
  it("preserves the seed offset from the run's Davao date, never a date before this run", () => {
    const view = { ...firstView(snapshot), events: [{ type: "run.state", at: "2026-11-04T00:10:00.000Z" }] };
    const result = cashDayForRun(snapshot, view as never);
    expect(result >= "2026-11-04").toBe(true);
    const offset = Math.max(0, Date.parse(snapshot.run.cashDay) - Date.parse(snapshot.run.recordedOn));
    expect(result).toBe(new Date(Date.parse("2026-11-04") + offset).toISOString().slice(0, 10));
  });
  it("keeps the labelled showcase's cash day", () => {
    expect(cashDayForRun(snapshot, firstView(snapshot))).toBe(snapshot.run.cashDay);
  });
});

it("POSTING says confirmations are arriving, rather than asking for keys again", () => {
  // The run's status row reads "0/8 confirmed · posted 10:00:00 · 0:05"; the money bar's in-flight row is "Sent".
  expect(FANOUT.posted("10:00:00", "0:05")).toBe("posted 10:00:00 · 0:05");
  expect(FANOUT.legend.flight).toBe("Sent");
});
