// Tests that kill mutation-testing survivors (handoff T3) in the engine's holds (lines 1-300 of
// engine.ts): which copy of a duplicated slip is kept (the white original, then the lower document,
// then the lower row), re-shoots found by dHash and their three resolutions, low-confidence gates,
// rows whose kilos are not known, and the input checks. Each resolution moves money: COUNT_ONCE drops
// a row's kilos from everyone's split.
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
const resolve = (key: string, resolution: string, extra: Record<string, unknown> = {}) =>
  ({ holdKey: key, resolution, by: "AS", at: AT, ...extra }) as EngineInput["resolutions"][number];

describe("duplicates: which copy is the keeper", () => {
  it("the white original is kept even when the pink copy has the lower row and document IDs", () => {
    const white = row("M-001", 40, {
      serial: "0457",
      copy: "WHITE_ORIGINAL",
      rowId: "z-white",
      documentId: "doc-Z",
    });
    const pink = row("M-001", 41, {
      serial: "0457",
      copy: "PINK_DUPLICATE",
      rowId: "a-pink",
      documentId: "doc-A",
    });
    const out = computeLines(input([member("M-001")], [pink, white]));
    const h = holdOf(out, holdKey.duplicate("0457"));
    expect(h).toMatchObject({
      serials: ["0457"],
      rowIds: ["z-white", "a-pink"],
      documentIds: ["doc-Z", "doc-A"],
      params: {
        signal: "SAME_SERIAL",
        copies: [
          { rowId: "z-white", copy: "WHITE_ORIGINAL", photoId: null, documentId: "doc-Z" },
          { rowId: "a-pink", copy: "PINK_DUPLICATE", photoId: null, documentId: "doc-A" },
        ],
        kilosMatch: false,
        payableG: 40_000,
        payableDisplay: "40.0 kg",
      },
    });
    const once = computeLines(
      input([member("M-001")], [pink, white], {
        resolutions: [resolve(holdKey.duplicate("0457"), "COUNT_ONCE")],
      }),
    );
    expect(line(once, "M-001").verifiedG).toBe(40_000);
  });

  it("between equal copies the lower document wins, then the lower row; an unknown copy comes last", () => {
    const a = row("M-001", 10, { serial: "0500", copy: "PINK_DUPLICATE", rowId: "r-2", documentId: "doc-2" });
    const b = row("M-001", 10, { serial: "0500", copy: "PINK_DUPLICATE", rowId: "r-1", documentId: "doc-1" });
    const c = row("M-001", 10, { serial: "0500", copy: "LOGBOOK_LINE", rowId: "r-0", documentId: "doc-0" });
    const d = row("M-001", 10, {
      serial: "0500",
      copy: "SOMETHING_ELSE" as never,
      rowId: "r-00",
      documentId: "doc-00",
    });
    const out = computeLines(input([member("M-001")], [d, c, a, b]), { validate: false });
    expect(holdOf(out, holdKey.duplicate("0500"))).toMatchObject({
      rowIds: ["r-1", "r-2", "r-0", "r-00"],
      params: { kilosMatch: true },
    });
    const sameDoc = [
      row("M-001", 10, { serial: "0600", copy: "PINK_DUPLICATE", rowId: "r-b", documentId: "doc-x" }),
      row("M-001", 10, { serial: "0600", copy: "PINK_DUPLICATE", rowId: "r-a", documentId: "doc-x" }),
    ];
    expect(
      holdOf(computeLines(input([member("M-001")], sameDoc)), holdKey.duplicate("0600"))?.rowIds,
    ).toEqual(["r-a", "r-b"]);
  });

  it("a keeper whose kilos wait for a person shows no kilo figure", () => {
    const unread = row("M-001", 10, { serial: "0700", payableG: null, rowId: "r-a" });
    const copy = row("M-001", 10, { serial: "0700", copy: "PINK_DUPLICATE", rowId: "r-b" });
    const h = holdOf(computeLines(input([member("M-001")], [unread, copy])), holdKey.duplicate("0700"));
    expect(h?.params).toMatchObject({ payableG: null, payableDisplay: null });
  });

  it("a resolution that does not apply to the hold kind is not recorded on it", () => {
    const rows = [
      row("M-001", 10, { serial: "0800" }),
      row("M-001", 10, { serial: "0800", copy: "PINK_DUPLICATE" }),
    ];
    const out = computeLines(
      input([member("M-001")], rows, {
        resolutions: [resolve(holdKey.duplicate("0800"), "CONFIRM_AS_READ")],
      }),
    );
    expect(holdOf(out, holdKey.duplicate("0800"))).toMatchObject({ state: "OPEN", resolution: null });
  });
});

describe("re-shoots (near duplicates by dHash)", () => {
  const rows = (): [EngineRow, EngineRow] => [
    row("M-001", 30, { serial: "0301", copy: "PINK_DUPLICATE", rowId: "a-pink", documentId: "doc-p" }),
    row("M-001", 20, { serial: "0391", copy: "WHITE_ORIGINAL", rowId: "z-white", documentId: "doc-w" }),
  ];
  const run = (dhashDistance: number, resolution?: string, pair = rows()) => {
    const [a, b] = pair;
    const key = holdKey.nearDuplicate(a.rowId, b.rowId);
    return {
      key,
      out: computeLines(
        input([member("M-001"), member("M-002")], [...pair, row("M-002", 50)], {
          nearDuplicates: [{ rowA: a.rowId, rowB: b.rowId, dhashDistance }],
          resolutions: resolution
            ? [resolve(key, resolution, resolution === "COUNT_ONCE" ? {} : { reason: "checked" })]
            : [],
        }),
      ),
    };
  };

  it("raises a blocking hold at distance 8, keeper first, with the signal", () => {
    const { key, out } = run(8);
    expect(holdOf(out, key)).toMatchObject({
      kind: "DUPLICATE_SLIP",
      gate: "BLOCKS_APPROVAL",
      state: "OPEN",
      memberNo: "M-001",
      serials: ["0391", "0301"],
      rowIds: ["z-white", "a-pink"],
      documentIds: ["doc-w", "doc-p"],
      params: { signal: "DHASH", dhashDistance: 8 },
      resolution: null,
    });
    expect(line(out, "M-001").state).toBe("HELD");
  });

  it("COUNT_ONCE drops the second copy's kilos; TWO_DELIVERIES keeps both; EXCLUDE_LINE carries the line", () => {
    const once = run(3, "COUNT_ONCE");
    expect(holdOf(once.out, once.key)).toMatchObject({
      state: "RESOLVED",
      resolution: { kind: "COUNT_ONCE", by: "AS" },
    });
    expect(line(once.out, "M-001").verifiedG).toBe(20_000);
    const both = run(3, "TWO_DELIVERIES");
    expect(holdOf(both.out, both.key)?.state).toBe("RESOLVED");
    expect(line(both.out, "M-001").verifiedG).toBe(50_000);
    const excluded = run(3, "EXCLUDE_LINE");
    expect(holdOf(excluded.out, excluded.key)?.state).toBe("EXCLUDED");
    expect(line(excluded.out, "M-001").state).toBe("EXCLUDED");
  });

  it("no hold past distance 8, for a row the input does not hold, or for the same serial", () => {
    expect(run(9).out.holds.filter((h) => h.kind === "DUPLICATE_SLIP")).toEqual([]);
    const [a] = rows();
    const out = computeLines(
      input([member("M-001")], [a], {
        nearDuplicates: [{ rowA: a.rowId, rowB: "missing", dhashDistance: 1 }],
      }),
    );
    const dups = (o: EngineOutput) => o.holds.filter((h) => h.kind === "DUPLICATE_SLIP");
    expect(dups(out)).toEqual([]);
    const missingA = computeLines(
      input([member("M-001")], [a], {
        nearDuplicates: [{ rowA: "missing", rowB: a.rowId, dhashDistance: 1 }],
      }),
    );
    expect(dups(missingA)).toEqual([]);
    const same = rows();
    same[1] = { ...same[1], serial: "0301" };
    const sameSerial = run(1, undefined, same);
    expect(dups(sameSerial.out).map((h) => h.key)).toEqual([holdKey.duplicate("0301")]);
  });

  it("several re-shoots are each held under their own key", () => {
    const r = [
      row("M-001", 10, { serial: "0901", rowId: "r-a" }),
      row("M-001", 10, { serial: "0902", rowId: "r-b" }),
      row("M-001", 10, { serial: "0903", rowId: "r-c" }),
    ];
    const out = computeLines(
      input([member("M-001")], r, {
        nearDuplicates: [
          { rowA: "r-c", rowB: "r-b", dhashDistance: 2 },
          { rowA: "r-a", rowB: "r-b", dhashDistance: 2 },
        ],
      }),
    );
    expect(out.holds.filter((h) => h.kind === "DUPLICATE_SLIP").map((h) => h.key)).toEqual([
      holdKey.nearDuplicate("r-a", "r-b"),
      holdKey.nearDuplicate("r-b", "r-c"),
    ]);
  });
});

describe("resolved holds record their resolution", () => {
  it("TWO_DELIVERIES on the same serial resolves the hold; CONFIRM_AS_READ on a doubtful field records it", () => {
    const rows = [
      row("M-001", 10, { serial: "0461" }),
      row("M-001", 10, { serial: "0461", copy: "PINK_DUPLICATE" }),
    ];
    const both = computeLines(
      input([member("M-001")], rows, {
        resolutions: [resolve(holdKey.duplicate("0461"), "TWO_DELIVERIES", { reason: "two loads" })],
      }),
    );
    expect(holdOf(both, holdKey.duplicate("0461"))).toMatchObject({
      state: "RESOLVED",
      resolution: { kind: "TWO_DELIVERIES", by: "AS", at: AT },
    });
    const doubtful = row("M-001", 10, {
      pendingFields: [{ fieldId: "f", field: "member_name", score: 0.5 }],
    });
    const confirmed = computeLines(
      input([member("M-001")], [doubtful], {
        resolutions: [resolve(holdKey.lowConfidence(doubtful.rowId), "CONFIRM_AS_READ")],
      }),
    );
    expect(holdOf(confirmed, holdKey.lowConfidence(doubtful.rowId))).toMatchObject({
      state: "RESOLVED",
      resolution: { kind: "CONFIRM_AS_READ", by: "AS", at: AT },
    });
  });
});

describe("low confidence", () => {
  const pending = (fields: [string, string, number][]) =>
    fields.map(([fieldId, field, score]) => ({ fieldId, field, score })) as EngineRow["pendingFields"];

  it("one blocking field among others blocks approval; minScore and fields are reported", () => {
    const r = row("M-001", 10, {
      pendingFields: pending([
        ["f1", "member_name", 0.7],
        ["f2", "grade", 0.4],
      ]),
    });
    const h = computeLines(input([member("M-001")], [r])).holds.find((x) => x.kind === "LOW_CONFIDENCE");
    expect(h).toMatchObject({
      gate: "BLOCKS_APPROVAL",
      serials: [r.serial],
      rowIds: [r.rowId],
      documentIds: [r.documentId],
      params: {
        fields: [
          { fieldId: "f1", field: "member_name", score: 0.7 },
          { fieldId: "f2", field: "grade", score: 0.4 },
        ],
        minScore: 0.4,
      },
      resolution: null,
    });
  });

  it("a doubtful kilo field among others leaves the kilos unconfirmed; a doubtful grade does not", () => {
    const kilo = row("M-001", 10, {
      pendingFields: pending([
        ["f1", "member_name", 0.7],
        ["f2", "net_kg", 0.4],
      ]),
    });
    const outKilo = computeLines(input([member("M-001")], [kilo]));
    expect(line(outKilo, "M-001").verifiedG).toBe(0);
    expect(outKilo.massBalance.pendingRowIds).toEqual([kilo.rowId]);
    const grade = row("M-001", 10, { pendingFields: pending([["f2", "grade", 0.4]]) });
    expect(line(computeLines(input([member("M-001")], [grade])), "M-001").verifiedG).toBe(10_000);
  });

  it("CONFIRM_AS_READ does not resolve a row whose kilos are still unread", () => {
    const r = row("M-001", 10, { payableG: null, pendingFields: pending([["f1", "net_kg", 0.3]]) });
    const out = computeLines(
      input([member("M-001")], [r], {
        resolutions: [resolve(holdKey.lowConfidence(r.rowId), "CONFIRM_AS_READ")],
      }),
    );
    expect(out.holds.find((h) => h.kind === "LOW_CONFIDENCE")).toMatchObject({
      state: "OPEN",
      resolution: null,
    });
  });
});

describe("rows and input", () => {
  it("a row with no kilos yet is pending in the mass balance, not counted", () => {
    const r = row("M-001", 10, { payableG: null });
    const out = computeLines(input([member("M-001")], [r, row("M-001", 5)]));
    expect(out.massBalance).toMatchObject({ status: "PENDING", pendingRowIds: [r.rowId], verifiedG: 5_000 });
  });

  it("lists each line's slips exactly, members in member-number order", () => {
    const rows = [row("M-002", 1, { serial: "0102" }), row("M-001", 1, { serial: "0101" })];
    const out = computeLines(input([member("M-002"), member("M-001")], rows));
    expect(out.lines.map((l) => [l.memberNo, l.slipSerials])).toEqual([
      ["M-001", ["0101"]],
      ["M-002", ["0102"]],
    ]);
  });

  it("refuses a row ID twice; validates the input unless told not to", () => {
    const r = row("M-001", 1);
    expect(() => computeLines(input([member("M-001")], [r, { ...r, serial: "9999" }]))).toThrow(
      `duplicate row ${r.rowId}`,
    );
    const bad = { ...input([member("M-001")], [row("M-001", 1)]), fx: { num: 0, den: 2 } } as EngineInput;
    expect(() => computeLines(bad)).toThrow(expect.objectContaining({ name: "ZodError" }));
    expect(() => computeLines(bad, { validate: false })).toThrow(RangeError);
  });
});
