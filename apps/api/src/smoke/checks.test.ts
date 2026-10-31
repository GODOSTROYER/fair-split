// The smoke's verdicts on the judge path (./checks.ts). In a judge session Mark paid must succeed and the reading must
// open the review with the seed's holds, 4 open and 3 blocking, with slip 0462's stained gross and net waiting for a
// person. A Mark paid that answers 200 but funds nothing (the run still INVOICED), a 429 QUEUED on Mark paid, or a
// review with other holds fails the smoke; before, each of these still printed SMOKE OK.
import { ApiClientError } from "@fairsplit/api-client";
import { describe, expect, it } from "vitest";
import { byHandVerdict, judgeFailure, readingVerdict } from "./checks.js";

const queued = new ApiClientError(
  { code: "QUEUED", status: 429, message: "recordPayment failed; it will be retried.", retryAfterMs: 5_000 },
  { command: "markPaid", rail: "simulated", requestId: null },
);

describe("smoke: the judge path's verdicts", () => {
  it("a 429 QUEUED on markPaid is not a listed refusal here: in a judge session Mark paid must succeed", () => {
    const v = judgeFailure("markPaid", queued);
    expect(v.ok).toBe(false);
    expect(v.outcome).toMatch(/QUEUED \(not accepted here\)/);
    // other commands may still answer with one of their listed refusals
    expect(judgeFailure("resolveHold", queued).ok).toBe(true);
  });

  it("the reading fails when Mark paid answered 200 but the run is still INVOICED (it funded nothing)", () => {
    const v = readingVerdict({
      markPaid: true,
      state: "INVOICED",
      holds: { open: 0, blocking: 0 },
      secs: "0.5",
    });
    expect(v.ok).toBe(false);
    expect(v.outcome).toMatch(/INVOICED/);
  });

  it("the reading fails when Mark paid did not succeed, or the run is still reading, or never read", () => {
    expect(readingVerdict({ markPaid: false, state: "INVOICED", holds: null, secs: "0" }).ok).toBe(false);
    expect(readingVerdict({ markPaid: true, state: "EXTRACTING", holds: null, secs: "40.0" }).ok).toBe(false);
    expect(readingVerdict({ markPaid: true, state: null, holds: null, secs: "40.0" }).ok).toBe(false);
    expect(readingVerdict({ markPaid: true, state: "HALTED", holds: null, secs: "1.0" }).ok).toBe(false);
  });

  it("the reading passes only at IN_REVIEW with 4 open / 3 blocking holds", () => {
    expect(
      readingVerdict({ markPaid: true, state: "IN_REVIEW", holds: { open: 4, blocking: 3 }, secs: "11.2" }),
    ).toEqual({
      ok: true,
      outcome: "state IN_REVIEW after 11.2 s, holds 4 open / 3 blocking",
    });
    for (const holds of [
      { open: 3, blocking: 3 },
      { open: 4, blocking: 2 },
      { open: 0, blocking: 0 },
    ]) {
      expect(readingVerdict({ markPaid: true, state: "IN_REVIEW", holds, secs: "11.2" }).ok).toBe(false);
    }
  });

  it("slip 0462 passes only when its stained gross and net both wait for a person", () => {
    const field = (name: string, merge: string, finalValue: string | null) => ({
      field: name,
      displayMerge: merge,
      finalValue,
      decidedBy: finalValue === null ? null : "agreement",
    });
    const waiting = {
      slips: [
        {
          fields: [
            field("gross_kg", "6?.80", null),
            field("net_kg", "6?.50", null),
            field("tare_kg", "0.30", "0.30"),
          ],
        },
      ],
    };
    expect(byHandVerdict(waiting)).toEqual({
      ok: true,
      outcome: "0462 gross 6?.80 and net 6?.50 wait for a person",
    });
    const decided = {
      slips: [{ fields: [field("gross_kg", "64.80", "64.80"), field("net_kg", "6?.50", null)] }],
    };
    expect(byHandVerdict(decided).ok).toBe(false);
    expect(byHandVerdict({ slips: [] }).ok).toBe(false);
    expect(byHandVerdict(null).ok).toBe(false);
  });
});
