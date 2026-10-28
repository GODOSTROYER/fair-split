import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SLIP_0449, SLIP_0462 } from "../src/content/spike.js";
import { type SlipFixture, SlipImageFixture } from "../src/fixtures/schema.js";
import { applyObservations } from "../src/imagegen/review.js";
import { judgeReadReport } from "../src/review/evidence.js";
import { replayBlockers } from "../src/review/session.js";
import { describeLeaks, stainLeaks } from "../src/review/stain.js";
import { recordReadVerdict } from "../src/review/verdict.js";
import { MEDIA_ROOT } from "../src/util/env.js";
import { SHA_A, SHA_B, slipPageFixture } from "./support.js";

/**
 * verify:media minors: a trap verdict must rest on a WS-READ eval report of this very slip (not any file in
 * the repo), and 0462's stain may not reach HOLDS while other boxes give its value away unless the user
 * has decided that is acceptable.
 */

const committed = (id: string) =>
  SlipImageFixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", `${id}.json`), "utf8")));

function slipOf(f: SlipImageFixture, slot = "ONLY"): SlipFixture {
  const s = f.slips.find((x) => x.slot === slot);
  if (!s) throw new Error(`${f.id} has no ${slot}`);
  return s;
}

describe("stain leaks: boxes that give a stained value away (S4.2 row checks)", () => {
  it("works out the committed 0462 flat's stained gross and net from boxes 11, 10 and 7", () => {
    const leaks = stainLeaks(slipOf(committed("spike-0462")));
    expect(leaks.map((l) => [l.field, l.visible, l.derived, l.boxes])).toEqual([
      ["gross_kg", "6?.80", "64.80", [11, 10, 7]],
      ["net_kg", "6?.50", "64.50", [11, 10]],
    ]);
    expect(describeLeaks(leaks)).toMatch(/box 6 "6\?\.80" is 64\.80 from boxes 11, 10, 7/);
  });

  it("finds nothing once box 11 is stained too, or when the stain hides nothing (the four-slip photo)", () => {
    const f = committed("spike-0462");
    const slip = slipOf(f);
    slip.fields.payable_kg.visible = "6?.50";
    expect(stainLeaks(slip)).toEqual([]);
    // In the four-slip photo a ghost of the 4 stays readable: nothing is hidden, so nothing leaks (the
    // trap there failed outright).
    expect(stainLeaks(slipOf(committed("spike-4up"), "BR"))).toEqual([]);
  });

  it("ignores arithmetic that contradicts what the stain leaves visible", () => {
    const slip = slipOf(committed("spike-0462"));
    slip.fields.payable_kg.visible = "70.00";
    expect(stainLeaks(slip)).toEqual([]);
  });

  it("counts only readable boxes: an illegible or blank box gives nothing away", () => {
    const slip = slipOf(committed("spike-0462"));
    slip.fields.mc_less_kg.legibility = "ILLEGIBLE";
    expect(stainLeaks(slip)).toEqual([]);
  });

  it("treats a stained box a reviewer recorded as illegible or blank as fully hidden: boxes 11, 10 and 7 still give it away", () => {
    for (const legibility of ["ILLEGIBLE", "ABSENT"] as const) {
      const slip = slipOf(committed("spike-0462"));
      for (const k of ["gross_kg", "net_kg"] as const) {
        Object.assign(slip.fields[k], { legibility, visible: legibility === "ABSENT" ? "" : "??.??" });
      }
      const leaks = stainLeaks(slip);
      expect(
        leaks.map((l) => [l.field, l.derived, l.boxes]),
        legibility,
      ).toEqual([
        ["gross_kg", "64.80", [11, 10, 7]],
        ["net_kg", "64.50", [11, 10]],
      ]);
      expect(describeLeaks(leaks)).toMatch(
        new RegExp(`box 6 \\(${legibility.toLowerCase()}\\) is 64\\.80 from boxes 11, 10, 7`),
      );
      // Stained over box 11 as well, nothing readable is left to work them out from.
      slip.fields.payable_kg.visible = "6?.50";
      expect(stainLeaks(slip), legibility).toEqual([]);
    }
  });

  it("decides which boxes are stained from the request, so a stained box typed as no number at all is fully hidden too", () => {
    const slip = slipOf(committed("spike-0462"));
    Object.assign(slip.fields.gross_kg, { legibility: "SMUDGED", visible: "" });
    const leaks = stainLeaks(slip);
    expect(leaks.map((l) => [l.field, l.concealed, l.derived])).toEqual([
      ["gross_kg", "fully", "64.80"],
      ["net_kg", "partly", "64.50"],
    ]);
    expect(describeLeaks(leaks)).toMatch(
      /^box 6 "" is 64\.80 from boxes 11, 10, 7; box 8 "6\?\.50" is 64\.50/,
    );
    // An unstained box that reads as no number is simply unknown: it hides no stain.
    const plain = slipOf(committed("spike-0462"));
    Object.assign(plain.fields.tare_kg, { legibility: "SMUDGED", visible: "" });
    expect(stainLeaks(plain).map((l) => l.field)).toEqual(["net_kg"]);
  });
});

describe("a stain that leaks cannot hold without the user's decision", () => {
  const AT = "2026-10-24T03:00:00.000Z";
  const verdict = {
    slot: "ONLY",
    trap: "WATER_STAIN",
    evidenceFile: "packages/eval/report/history/r.json",
    evidenceSha256: SHA_A,
    at: AT,
  } as const;

  function agentChecked() {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    applyObservations(f, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    return f;
  }

  it("refuses HOLDS while box 11 gives the value away, and records the decision that accepts it", () => {
    const f = agentChecked();
    expect(() => recordReadVerdict(f, { ...verdict, status: "HOLDS" })).toThrow(
      /stain leaks[\s\S]*--accept-leak/,
    );
    expect(slipOf(f).trapChecks[0]).toMatchObject({ status: "UNVERIFIED", by: null });
    recordReadVerdict(f, {
      ...verdict,
      status: "HOLDS",
      leakAccepted: "user, 24 Oct: box 11 stays readable",
    });
    expect(slipOf(f).trapChecks[0]).toMatchObject({
      status: "HOLDS",
      by: "read",
      leakAccepted: "user, 24 Oct: box 11 stays readable",
    });
    expect(SlipImageFixture.safeParse(f).success).toBe(true);
  });

  it("refuses HOLDS, and replay-check names the leak, when a person recorded the stained boxes as illegible", () => {
    const f = agentChecked();
    for (const k of ["gross_kg", "net_kg"] as const) {
      Object.assign(slipOf(f).fields[k], { legibility: "ILLEGIBLE", expect: "HUMAN", checkedBy: "human" });
    }
    expect(() => recordReadVerdict(f, { ...verdict, status: "HOLDS" })).toThrow(
      /stain leaks: box 6 \(illegible\) is 64\.80 from boxes 11, 10, 7[\s\S]*--accept-leak/,
    );
    expect(slipOf(f).trapChecks[0]).toMatchObject({ status: "UNVERIFIED", by: null });
    expect(replayBlockers(f).join(" ")).toMatch(/the stain leaks: box 6 \(illegible\) is 64\.80/);
  });

  it("a failed read needs no decision", () => {
    const f = agentChecked();
    recordReadVerdict(f, { ...verdict, status: "FAILED" });
    expect(slipOf(f).trapChecks[0]).toMatchObject({ status: "FAILED", by: "read" });
  });

  it("refuses HOLDS when the label does not send the stained fields to a person (a pass would prove nothing)", () => {
    const f = agentChecked();
    slipOf(f).fields.gross_kg.expect = "EITHER";
    expect(() =>
      recordReadVerdict(f, { ...verdict, status: "HOLDS", leakAccepted: "user decision" }),
    ).toThrow(/gross_kg is EITHER, not HUMAN/);
  });

  it("replay-check names the leak until the decision is recorded, even on a verdict written by hand", () => {
    const f = agentChecked();
    expect(replayBlockers(f).join(" ")).toMatch(/must be shown to hold[\s\S]*stain leaks: box 6/);
    Object.assign(slipOf(f).trapChecks[0] ?? {}, { status: "HOLDS", by: "read", at: AT, evidence: "x" });
    expect(replayBlockers(f).join(" ")).toMatch(/holds by a recorded read, but the stain leaks/);
    Object.assign(slipOf(f).trapChecks[0] ?? {}, { leakAccepted: "user, 24 Oct" });
    expect(replayBlockers(f).join(" ")).not.toMatch(/stain leaks/);
  });

  it("the schema keeps a non-empty leak decision on a WATER_STAIN check only", () => {
    const stain = slipPageFixture("spike-0462", SLIP_0462);
    Object.assign(slipOf(stain).trapChecks[0] ?? {}, { leakAccepted: "user, 24 Oct" });
    expect(SlipImageFixture.safeParse(stain).success).toBe(true);
    Object.assign(slipOf(stain).trapChecks[0] ?? {}, { leakAccepted: "" });
    expect(SlipImageFixture.safeParse(stain).success).toBe(false);
    const note = slipPageFixture("spike-0449", SLIP_0449);
    expect(slipOf(note).trapChecks[0]?.trap).toBe("MARGIN_NOTE");
    Object.assign(slipOf(note).trapChecks[0] ?? {}, { leakAccepted: "user, 24 Oct" });
    expect(SlipImageFixture.safeParse(note).error?.message).toMatch(/only a WATER_STAIN check/);
  });
});

describe("trap verdict evidence: a WS-READ eval report that read this slip (packages/eval/src/report.ts v1)", () => {
  const MADE = "2026-10-22T07:22:08.597Z";
  const report = (cells: object[], over: object = {}) =>
    Buffer.from(
      JSON.stringify({
        v: 1,
        generated_at: "2026-10-24T02:00:00.000Z",
        mode: "live",
        set: "dev",
        case_count: cells.length,
        cases: cells,
        metrics: {},
        green: false,
        ...over,
      }),
    );
  const cell = (pass: boolean | null, extra: object = {}) => ({
    id: "spike-0462#ONLY",
    kind: "slip",
    pass,
    reasons: pass ? [] : ["row not exact"],
    ...extra,
  });
  const input = (over: Partial<Parameters<typeof judgeReadReport>[0]> = {}) => ({
    file: "packages/eval/report/history/2026-10-24T02-00-00-000Z-live-dev.json",
    bytes: report([cell(true)]),
    fixtureId: "spike-0462",
    slot: "ONLY" as const,
    status: "HOLDS" as const,
    masterSha256: SHA_A,
    masterMadeAt: MADE,
    ...over,
  });

  it("accepts a report that read this slip after its master was made and agrees with the verdict", () => {
    const r = judgeReadReport(input());
    expect(r).toEqual({
      ok: true,
      note: expect.stringMatching(/READ live\/dev report of 2026-10-24T02:00:00\.000Z: spike-0462#ONLY pass/),
    });
    expect(judgeReadReport(input({ status: "FAILED", bytes: report([cell(false)]) })).ok).toBe(true);
  });

  it("refuses anything but a WS-READ eval report: a README, a recording, a path outside packages/eval/report/", () => {
    for (const file of [
      "README.md",
      "package.json",
      "packages/eval/recordings/abc.json",
      "media/review/x.json",
    ]) {
      const r = judgeReadReport(input({ file }));
      expect(r.ok, file).toBe(false);
      expect(r.ok ? "" : r.why).toMatch(/WS-READ eval report under packages\/eval\/report\//);
    }
    expect(judgeReadReport(input({ bytes: Buffer.from("# not json") })).ok).toBe(false);
    const notReport = judgeReadReport(input({ bytes: Buffer.from(JSON.stringify({ hello: "world" })) }));
    expect(notReport.ok ? "" : notReport.why).toMatch(/not a WS-READ eval report/);
  });

  it("refuses a report that did not read this slip, or did not evaluate it", () => {
    const other = judgeReadReport(input({ bytes: report([{ ...cell(true), id: "spike-0403#ONLY" }]) }));
    expect(other.ok ? "" : other.why).toMatch(/no slip cell spike-0462#ONLY/);
    const notEvaluated = judgeReadReport(input({ bytes: report([cell(null)]) }));
    expect(notEvaluated.ok ? "" : notEvaluated.why).toMatch(/did not evaluate/);
  });

  it("refuses a verdict the report contradicts", () => {
    const holds = judgeReadReport(input({ bytes: report([cell(false)]) }));
    expect(holds.ok ? "" : holds.why).toMatch(/fails spike-0462#ONLY \(row not exact\)/);
    const failed = judgeReadReport(input({ status: "FAILED" }));
    expect(failed.ok ? "" : failed.why).toMatch(/passes spike-0462#ONLY/);
  });

  it("refuses a report made before this master existed, or for a master the manifest cannot date", () => {
    const old = judgeReadReport(
      input({ bytes: report([cell(true)], { generated_at: "2026-10-22T07:00:00.000Z" }) }),
    );
    expect(old.ok ? "" : old.why).toMatch(/predates this master/);
    const undated = judgeReadReport(input({ masterMadeAt: null }));
    expect(undated.ok ? "" : undated.why).toMatch(/no accepted exec/);
  });

  it("pins the image by sha256 when the report names it, and refuses other pixels", () => {
    expect(judgeReadReport(input({ bytes: report([cell(true, { image_sha256: SHA_A })]) }))).toMatchObject({
      ok: true,
      note: expect.stringContaining("image pinned by sha256"),
    });
    const other = judgeReadReport(input({ bytes: report([cell(true, { image_sha256: SHA_B })]) }));
    expect(other.ok ? "" : other.why).toMatch(/read other pixels/);
  });
});
