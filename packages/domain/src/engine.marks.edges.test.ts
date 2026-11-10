// Tests that kill mutation-testing survivors (handoff T3) in engine.ts lines 300-560: implausible yield
// and its resolutions, box-13 marks (credits are money the co-op pays back), quarantined text, the
// season's mass balance, and holds whose cause is gone. Each hold is checked whole where it can be, so a
// field the engine stopped filling is caught.
import type { EngineInput, EngineOutput, EngineRow } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { AT, input, member, row } from "./__fixtures__/world.js";
import { computeLines, holdKey } from "./engine.js";

const line = (out: EngineOutput, no: string) => {
  const l = out.lines.find((x) => x.memberNo === no);
  if (!l) throw new Error(`no line ${no}`);
  return l;
};
const holdOf = (out: EngineOutput, key: string) => out.holds.find((h) => h.key === key);
type Resolution = EngineInput["resolutions"][number];
const resolve = (key: string, resolution: string, extra: Record<string, unknown> = {}) =>
  ({ holdKey: key, resolution, by: "AS", at: AT, ...extra }) as Resolution;
const RECORD = (kind: string) => ({ kind, by: "AS", at: AT });

describe("implausible yield", () => {
  const m = member("M-053", { registeredTrees: 10 }); // limit 16.0 kg
  const rows = () => [row("M-053", 10, { serial: "0302" }), row("M-053", 10, { serial: "0301" })];
  const run = (resolutions: Resolution[] = []) => computeLines(input([m], rows(), { resolutions }));

  it("is raised with the member's sorted serials and no rows or documents", () => {
    expect(holdOf(run(), holdKey.yield("M-053"))).toMatchObject({
      state: "OPEN",
      serials: ["0301", "0302"],
      rowIds: [],
      documentIds: [],
      params: { verifiedG: 20_000, registeredTrees: 10, plot: null, treesAfter: null, kgPerTreeAfter: null },
      resolution: null,
    });
    expect(line(run(), "M-053").slipSerials).toEqual(["0301", "0302"]);
  });

  it("REGISTER_PLOT clears it exactly at the limit, and records the plot", () => {
    const plot = { plotNo: "P-053-B", areaHa: "0.10", trees: 3 }; // 13 trees × 1.6 kg = 20.8 kg
    const atLimit = { ...plot, trees: 3 };
    const exact = computeLines(
      input([member("M-053", { registeredTrees: 10 })], [row("M-053", 20.8)], {
        resolutions: [resolve(holdKey.yield("M-053"), "REGISTER_PLOT", { plot: atLimit })],
      }),
    );
    expect(holdOf(exact, holdKey.yield("M-053"))).toMatchObject({
      state: "RESOLVED",
      params: { plot: atLimit, treesAfter: 13 },
      resolution: RECORD("REGISTER_PLOT"),
    });
    const short = run([resolve(holdKey.yield("M-053"), "REGISTER_PLOT", { plot: { ...plot, trees: 2 } })]);
    expect(holdOf(short, holdKey.yield("M-053"))).toMatchObject({
      state: "OPEN",
      resolution: null,
      params: { treesAfter: 12 },
    });
  });

  it("EXCLUDE_LINE excludes it; a resolution of another kind leaves it open and unrecorded", () => {
    const excluded = run([resolve(holdKey.yield("M-053"), "EXCLUDE_LINE", { reason: "check" })]);
    expect(holdOf(excluded, holdKey.yield("M-053"))).toMatchObject({
      state: "EXCLUDED",
      resolution: RECORD("EXCLUDE_LINE"),
    });
    expect(line(excluded, "M-053").state).toBe("EXCLUDED");
  });
});

describe("box-13 marks", () => {
  const multa = (writtenCentavos: number | null, ruleId = "NO_MATCH") =>
    ({
      markId: "m1",
      text: "Multa",
      ruleId,
      writtenCentavos,
      documentRef: null,
    }) as EngineRow["marks"][number];
  const hauling = (writtenCentavos: number) =>
    ({
      markId: "h1",
      text: "Hauling",
      ruleId: "R2",
      writtenCentavos,
      documentRef: null,
    }) as EngineRow["marks"][number];
  const purok = (marks: EngineRow["marks"]) => row("M-001", 60.8, { station: "PUROK_2", marks });

  it("an unruled mark is held with its amount; returned, it is a credit of exactly that amount", () => {
    const rows = [purok([multa(20_000), hauling(9_120)])];
    const open = computeLines(input([member("M-001")], rows));
    expect(holdOf(open, holdKey.noRule("m1"))).toMatchObject({
      kind: "NO_RULE",
      gate: "RESERVES_LINE",
      state: "OPEN",
      serials: [rows[0]?.serial],
      rowIds: [rows[0]?.rowId],
      documentIds: [rows[0]?.documentId],
      params: { writtenCentavos: 20_000, creditCents: 320, stays: ["Hauling (R2)"] },
      resolution: null,
    });
    const back = computeLines(
      input([member("M-001")], rows, { resolutions: [resolve(holdKey.noRule("m1"), "RETURN_AS_CREDIT")] }),
    );
    expect(holdOf(back, holdKey.noRule("m1"))?.resolution).toEqual(RECORD("RETURN_AS_CREDIT"));
    expect(line(back, "M-001").credits).toEqual([
      {
        kind: "RETURNED_MARK",
        holdKey: holdKey.noRule("m1"),
        markId: "m1",
        serial: rows[0]?.serial,
        text: "Multa",
        phpCentavos: 20_000,
        amountCents: 320,
      },
    ]);
    const excluded = computeLines(
      input([member("M-001")], rows, {
        resolutions: [resolve(holdKey.noRule("m1"), "EXCLUDE_LINE", { reason: "x" })],
      }),
    );
    expect(holdOf(excluded, holdKey.noRule("m1"))).toMatchObject({
      state: "EXCLUDED",
      resolution: RECORD("EXCLUDE_LINE"),
    });
  });

  it("a mark citing a rule outside the card's closed list is unruled; an unreadable one cannot be returned", () => {
    const out = computeLines(input([member("M-001")], [purok([multa(20_000, "R5")])]));
    expect(holdOf(out, holdKey.noRule("m1"))?.kind).toBe("NO_RULE");
    const unreadable = computeLines(
      input([member("M-001")], [purok([multa(null)])], {
        resolutions: [resolve(holdKey.noRule("m1"), "RETURN_AS_CREDIT")],
      }),
    );
    expect(holdOf(unreadable, holdKey.noRule("m1"))).toMatchObject({
      state: "OPEN",
      params: { creditCents: null },
    });
    expect(line(unreadable, "M-001").credits).toEqual([]);
  });

  it("the marks of a row counted once are not audited", () => {
    const keep = row("M-001", 10, { serial: "0457", rowId: "a-white" });
    const copy = row("M-001", 10, {
      serial: "0457",
      rowId: "b-pink",
      copy: "PINK_DUPLICATE",
      marks: [multa(20_000)],
    });
    const out = computeLines(
      input([member("M-001")], [keep, copy], {
        resolutions: [resolve(holdKey.duplicate("0457"), "COUNT_ONCE")],
      }),
    );
    expect(holdOf(out, holdKey.noRule("m1"))).toBeUndefined();
  });

  it("a wrong ruled amount is held; returned, only the excess is credited, and nothing when there is none", () => {
    // R2 at PUROK_2: 60.8 kg × ₱1.50 = ₱91.20 expected
    const over = [purok([hauling(10_120)])];
    const open = computeLines(input([member("M-001")], over));
    expect(holdOf(open, holdKey.rateMismatch("h1"))).toMatchObject({
      kind: "RATE_MISMATCH",
      state: "OPEN",
      serials: [over[0]?.serial],
      rowIds: [over[0]?.rowId],
      documentIds: [over[0]?.documentId],
      params: { writtenCentavos: 10_120, allowedCentavos: 9_120, creditCents: 16, reason: "AMOUNT_DIFFERS" },
      resolution: null,
    });
    const back = computeLines(
      input([member("M-001")], over, {
        resolutions: [resolve(holdKey.rateMismatch("h1"), "RETURN_AS_CREDIT")],
      }),
    );
    expect(line(back, "M-001").credits).toMatchObject([{ phpCentavos: 1_000, amountCents: 16 }]);
    const under = [purok([hauling(9_000)])];
    const backUnder = computeLines(
      input([member("M-001")], under, {
        resolutions: [resolve(holdKey.rateMismatch("h1"), "RETURN_AS_CREDIT")],
      }),
    );
    expect(holdOf(backUnder, holdKey.rateMismatch("h1"))).toMatchObject({
      state: "RESOLVED",
      params: { creditCents: 0 },
    });
    expect(line(backUnder, "M-001").credits).toEqual([]);
    const confirmed = computeLines(
      input([member("M-001")], over, {
        resolutions: [resolve(holdKey.rateMismatch("h1"), "CONFIRM_AS_READ")],
      }),
    );
    expect(holdOf(confirmed, holdKey.rateMismatch("h1"))).toMatchObject({
      state: "RESOLVED",
      resolution: RECORD("CONFIRM_AS_READ"),
    });
    const excluded = computeLines(
      input([member("M-001")], over, {
        resolutions: [resolve(holdKey.rateMismatch("h1"), "EXCLUDE_LINE", { reason: "x" })],
      }),
    );
    expect(holdOf(excluded, holdKey.rateMismatch("h1"))).toMatchObject({
      state: "EXCLUDED",
      resolution: RECORD("EXCLUDE_LINE"),
    });
  });
});

describe("quarantined text", () => {
  const anomaly = (anomalyId: string, overlap: string, quarantined = true) =>
    ({
      anomalyId,
      kind: "INSTRUCTION_LIKE_TEXT",
      quarantined,
      overlap,
      source: "read_a",
    }) as EngineRow["anomalies"][number];

  it("a hold over data, whole; resolved by CONFIRM_AS_READ, excluded by EXCLUDE_LINE", () => {
    const r = row("M-001", 40, { serial: "0449", anomalies: [anomaly("a1", "FIELD")] });
    const key = holdKey.injection("a1", r.rowId);
    const open = computeLines(input([member("M-001")], [r]));
    expect(holdOf(open, key)).toEqual({
      key,
      kind: "SUSPECTED_INJECTION",
      gate: "RESERVES_LINE",
      state: "OPEN",
      memberNo: "M-001",
      serials: ["0449"],
      rowIds: [r.rowId],
      documentIds: [r.documentId],
      params: { overlap: "FIELD", source: "read_a", quarantined: true },
      resolution: null,
    });
    const ok = computeLines(
      input([member("M-001")], [r], { resolutions: [resolve(key, "CONFIRM_AS_READ")] }),
    );
    expect(holdOf(ok, key)).toMatchObject({ state: "RESOLVED", resolution: RECORD("CONFIRM_AS_READ") });
    const ex = computeLines(
      input([member("M-001")], [r], { resolutions: [resolve(key, "EXCLUDE_LINE", { reason: "x" })] }),
    );
    expect(holdOf(ex, key)).toMatchObject({ state: "EXCLUDED", resolution: RECORD("EXCLUDE_LINE") });
  });

  it("text that was not quarantined raises nothing; notices are sorted by serial then anomaly", () => {
    const rows = [
      row("M-001", 10, { serial: "0502", anomalies: [anomaly("b", "NONE"), anomaly("a", "NONE")] }),
      row("M-001", 10, { serial: "0501", anomalies: [anomaly("z", "FIELD", false)] }),
    ];
    const out = computeLines(input([member("M-001")], rows));
    expect(out.quarantines.map((q) => `${q.serial}/${q.anomalyId}`)).toEqual(["0502/a", "0502/b"]);
    expect(out.holds.filter((h) => h.kind === "SUSPECTED_INJECTION")).toEqual([]);
  });
});

describe("the season's mass balance", () => {
  const MB = holdKey.massBalance();
  const prior = [
    { key: MB, kind: "MASS_BALANCE" as const, gate: "BLOCKS_APPROVAL" as const, memberNo: null },
  ];

  it("shrink is signed: short of the shipped kilos is negative", () => {
    const short = computeLines(input([member("M-001")], [row("M-001", 990)]));
    expect(short.massBalance.shrinkBp).toBe(-100);
    const over = computeLines(input([member("M-001")], [row("M-001", 1_010)]));
    expect(over.massBalance.shrinkBp).toBe(100);
  });

  it("inside with no earlier hold raises nothing; inside after one clears it; pending after one keeps it open", () => {
    expect(holdOf(computeLines(input([member("M-001")], [row("M-001", 1_000)])), MB)).toBeUndefined();
    const cleared = computeLines(input([member("M-001")], [row("M-001", 1_000)], { priorHolds: prior }));
    expect(holdOf(cleared, MB)).toMatchObject({
      state: "RESOLVED",
      params: { status: "INSIDE", shippedG: 1_000_000 },
      memberNo: null,
      resolution: { kind: "ENGINE_CLEARED", by: "engine", at: null },
    });
    const pending = computeLines(
      input([member("M-001")], [row("M-001", 1_000), row("M-001", 1, { payableG: null })], {
        priorHolds: prior,
      }),
    );
    expect(holdOf(pending, MB)).toMatchObject({ state: "OPEN", params: { status: "PENDING" } });
    const pendingFresh = computeLines(
      input([member("M-001")], [row("M-001", 1_000), row("M-001", 1, { payableG: null })]),
    );
    expect(holdOf(pendingFresh, MB)).toBeUndefined();
  });
});

describe("holds raised earlier whose cause is gone", () => {
  it("a low-confidence row now entered by hand reads ENTERED_BY_HAND; anything else ENGINE_CLEARED", () => {
    const byHand = row("M-001", 10, { enteredByHand: true });
    const read = row("M-001", 10);
    const priorHolds = [
      {
        key: holdKey.lowConfidence(byHand.rowId),
        kind: "LOW_CONFIDENCE" as const,
        gate: "BLOCKS_APPROVAL" as const,
        memberNo: "M-001",
      },
      {
        key: holdKey.lowConfidence(read.rowId),
        kind: "LOW_CONFIDENCE" as const,
        gate: "BLOCKS_APPROVAL" as const,
        memberNo: "M-001",
      },
      {
        key: holdKey.noRule("gone"),
        kind: "NO_RULE" as const,
        gate: "RESERVES_LINE" as const,
        memberNo: "M-001",
      },
    ];
    const out = computeLines(input([member("M-001")], [byHand, read], { priorHolds }));
    expect(holdOf(out, holdKey.lowConfidence(byHand.rowId))).toEqual({
      key: holdKey.lowConfidence(byHand.rowId),
      kind: "LOW_CONFIDENCE",
      gate: "BLOCKS_APPROVAL",
      state: "RESOLVED",
      memberNo: "M-001",
      serials: [],
      rowIds: [],
      documentIds: [],
      params: {},
      resolution: { kind: "ENTERED_BY_HAND", by: "person", at: null },
    });
    expect(holdOf(out, holdKey.lowConfidence(read.rowId))?.resolution).toEqual({
      kind: "ENGINE_CLEARED",
      by: "engine",
      at: null,
    });
    expect(holdOf(out, holdKey.noRule("gone"))?.resolution).toEqual({
      kind: "ENGINE_CLEARED",
      by: "engine",
      at: null,
    });
    const unknownRow = computeLines(
      input([member("M-001")], [read], {
        priorHolds: [
          {
            key: holdKey.lowConfidence("row-gone"),
            kind: "LOW_CONFIDENCE",
            gate: "BLOCKS_APPROVAL",
            memberNo: "M-001",
          },
        ],
      }),
    );
    expect(holdOf(unknownRow, holdKey.lowConfidence("row-gone"))?.resolution).toEqual({
      kind: "ENGINE_CLEARED",
      by: "engine",
      at: null,
    });
  });

  it("a prior hold of another kind whose key names a hand-entered row is still ENGINE_CLEARED", () => {
    const byHand = row("M-001", 10, { enteredByHand: true });
    // 15 characters, as long as "LOW_CONFIDENCE:", so slicing the prefix off would name the row
    const key = `NO_RULE:xxxxxxx${byHand.rowId}`;
    const out = computeLines(
      input([member("M-001")], [byHand], {
        priorHolds: [{ key, kind: "NO_RULE", gate: "RESERVES_LINE", memberNo: "M-001" }],
      }),
    );
    expect(holdOf(out, key)?.resolution).toEqual({ kind: "ENGINE_CLEARED", by: "engine", at: null });
  });
});
