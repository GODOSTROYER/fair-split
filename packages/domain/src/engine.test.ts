import type { EngineInput, EngineOutput } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AT, input, member, row, TEST_RULES } from "./__fixtures__/world.js";
import {
  ALLOWED_RESOLUTIONS,
  checkRuledMark,
  computeLines,
  conserve,
  holdKey,
  isOverride,
  isResolutionAllowed,
  lineSha256,
  payTimeDeductions,
} from "./engine.js";

const FX = { num: 125, den: 2 };
const line = (out: EngineOutput, no: string) => {
  const l = out.lines.find((x) => x.memberNo === no);
  if (!l) throw new Error(`no line ${no}`);
  return l;
};
const holdOf = (out: EngineOutput, key: string) => out.holds.find((h) => h.key === key);

describe("computeLines: shares (R0)", () => {
  it("splits premium by verified kilos and bonus by Grade-1 kilos, exactly", () => {
    const out = computeLines(
      input(
        [member("M-001"), member("M-002"), member("M-003")],
        [row("M-001", 500), row("M-002", 300), row("M-003", 200, { grade: "G2" })],
      ),
    );
    // pools: premium 1,000 kg × 30¢ = 30,000; bonus 900 kg × 15¢ = 13,500
    expect(line(out, "M-001").premiumCents).toBe(15_000);
    expect(line(out, "M-002").premiumCents).toBe(9_000);
    expect(line(out, "M-003").premiumCents).toBe(6_000);
    expect(line(out, "M-001").bonusCents).toBe(8_438); // 13,500 × 5/8 = 8,437.5 → tie broken to M-001
    expect(line(out, "M-002").bonusCents).toBe(5_062);
    expect(line(out, "M-003").bonusCents).toBe(0);
    expect(out.conservation.balanced).toBe(true);
    expect(out.conservation.premiumSumCents).toBe(30_000);
    expect(out.conservation.bonusSumCents).toBe(13_500);
  });

  it("is deterministic and order independent", () => {
    const members = [member("M-001"), member("M-002")];
    const rows = [row("M-001", 123.45), row("M-002", 67.8)];
    const a = computeLines(input(members, rows));
    const b = computeLines(input([...members].reverse(), [...rows].reverse()));
    expect(a).toEqual(b);
  });

  it("validates input: unknown members and duplicate members are refused", () => {
    expect(() => computeLines(input([member("M-001")], [row("M-009", 10)]))).toThrow(/unknown member/);
    expect(() => computeLines(input([member("M-001"), member("M-001")], []))).toThrow(/duplicate member/);
    expect(() =>
      computeLines({ ...input([member("M-001")], []), fx: { num: 0, den: 1 } } as EngineInput),
    ).toThrow();
  });
});

describe("computeLines: pay-time deductions (R1, R3, R4)", () => {
  it("takes CBU at 5% of the bonus, half-up, capped at what is left to ₱5,000 (rounded down)", () => {
    const d = payTimeDeductions({ cbuPaidUpCentavos: 0, loans: [], advances: [] }, 2_185, TEST_RULES, FX);
    expect(d).toEqual([
      {
        ruleId: "R1",
        category: "CBU",
        computedCents: 109,
        capCents: 8_000,
        amountCents: 109,
        ref: null,
        carriedCentavos: null,
      },
    ]);
    const near = payTimeDeductions(
      { cbuPaidUpCentavos: 499_900, loans: [], advances: [] },
      2_185,
      TEST_RULES,
      FX,
    );
    expect(near[0]?.amountCents).toBe(1); // ₱1 left → 1.6¢ rounded down
    expect(
      payTimeDeductions({ cbuPaidUpCentavos: 500_000, loans: [], advances: [] }, 2_185, TEST_RULES, FX),
    ).toEqual([]);
  });

  it("deducts a loan only with an Authority to Deduct, up to 50% of the bonus, carrying the rest", () => {
    const d = payTimeDeductions(
      {
        cbuPaidUpCentavos: 500_000,
        loans: [{ ref: "ATD-1", outstandingCentavos: 40_000, authorityToDeduct: true }],
        advances: [],
      },
      1_181,
      TEST_RULES,
      FX,
    );
    expect(d).toEqual([
      {
        ruleId: "R3",
        category: "LOAN",
        computedCents: 640,
        capCents: 590,
        amountCents: 590,
        ref: "ATD-1",
        carriedCentavos: 3_125,
      },
    ]);
    const noAtd = payTimeDeductions(
      {
        cbuPaidUpCentavos: 500_000,
        loans: [{ ref: "LN-1", outstandingCentavos: 40_000, authorityToDeduct: false }],
        advances: [],
      },
      1_181,
      TEST_RULES,
      FX,
    );
    expect(noAtd).toEqual([]);
  });

  it("deducts an advance only against a voucher, up to 30% of the bonus", () => {
    const d = payTimeDeductions(
      {
        cbuPaidUpCentavos: 500_000,
        loans: [],
        advances: [{ voucherNo: "CA-1", outstandingCentavos: 50_000 }],
      },
      2_000,
      TEST_RULES,
      FX,
    );
    expect(d[0]).toMatchObject({
      ruleId: "R4",
      computedCents: 800,
      capCents: 600,
      amountCents: 600,
      carriedCentavos: 12_500,
    });
    const noVoucher = payTimeDeductions(
      { cbuPaidUpCentavos: 500_000, loans: [], advances: [{ voucherNo: null, outstandingCentavos: 50_000 }] },
      2_000,
      TEST_RULES,
      FX,
    );
    expect(noVoucher).toEqual([]);
  });

  it("never deducts beyond the bonus, so the premium is never deducted", () => {
    const greedy = {
      ...TEST_RULES,
      cbu: { ...TEST_RULES.cbu, bp: 9_000 },
      loan: { ...TEST_RULES.loan, capBp: 9_000 },
    };
    const d = payTimeDeductions(
      {
        cbuPaidUpCentavos: 0,
        loans: [{ ref: "A", outstandingCentavos: 9_999_999, authorityToDeduct: true }],
        advances: [],
      },
      1_000,
      greedy,
      FX,
    );
    expect(d.reduce((s, x) => s + x.amountCents, 0)).toBeLessThanOrEqual(1_000);
  });
});

describe("computeLines: holds", () => {
  it("raises DUPLICATE_SLIP for the same serial twice; COUNT_ONCE keeps the white original", () => {
    const rows = [
      row("M-001", 42, { serial: "0457", copy: "WHITE_ORIGINAL", documentId: "doc-B", photoId: "B" }),
      row("M-001", 42, {
        serial: "0457",
        copy: "PINK_DUPLICATE",
        documentId: "doc-D",
        photoId: "D",
        rowId: "pink",
      }),
      row("M-002", 100),
    ];
    const members = [member("M-001", { rail: "PAYPAL" }), member("M-002")];
    const open = computeLines(input(members, rows));
    const h = holdOf(open, holdKey.duplicate("0457"));
    expect(h).toMatchObject({
      kind: "DUPLICATE_SLIP",
      gate: "BLOCKS_APPROVAL",
      state: "OPEN",
      memberNo: "M-001",
    });
    expect(line(open, "M-001").verifiedG).toBe(84_000);
    expect(line(open, "M-001").state).toBe("HELD");
    expect(open.approvalBlocked).toBe(true);
    const moved = Number(h?.params.movedCents);
    expect(moved).toBeGreaterThan(0);

    const once = computeLines(
      input(members, rows, {
        resolutions: [{ holdKey: holdKey.duplicate("0457"), resolution: "COUNT_ONCE", by: "AS", at: AT }],
      }),
    );
    expect(holdOf(once, holdKey.duplicate("0457"))?.state).toBe("RESOLVED");
    expect(line(once, "M-001").verifiedG).toBe(42_000);
    expect(line(once, "M-001").state).toBe("READY");
    expect(line(open, "M-001").netCents - line(once, "M-001").netCents).toBe(moved);
    expect(holdOf(once, holdKey.duplicate("0457"))?.params.movedCents).toBe(moved);

    const both = computeLines(
      input(members, rows, {
        resolutions: [
          {
            holdKey: holdKey.duplicate("0457"),
            resolution: "TWO_DELIVERIES",
            reason: "two loads",
            by: "AS",
            at: AT,
          },
        ],
      }),
    );
    expect(line(both, "M-001").verifiedG).toBe(84_000);
    expect(line(both, "M-001").state).toBe("READY");

    const excluded = computeLines(
      input(members, rows, {
        resolutions: [
          {
            holdKey: holdKey.duplicate("0457"),
            resolution: "EXCLUDE_LINE",
            reason: "check later",
            by: "AS",
            at: AT,
          },
        ],
      }),
    );
    expect(line(excluded, "M-001").state).toBe("EXCLUDED");
    expect(excluded.conservation.carriedNetCents).toBe(line(excluded, "M-001").netCents);
  });

  it("raises DUPLICATE_SLIP for a re-shoot (dHash ≤ 8) under another serial", () => {
    const rows = [row("M-001", 30, { serial: "0301" }), row("M-001", 30, { serial: "0391" })];
    const nd = [{ rowA: rows[0]?.rowId as string, rowB: rows[1]?.rowId as string, dhashDistance: 5 }];
    const out = computeLines(input([member("M-001")], rows, { nearDuplicates: nd }));
    expect(out.holds.filter((h) => h.kind === "DUPLICATE_SLIP")).toHaveLength(1);
    const far = computeLines(
      input([member("M-001")], rows, { nearDuplicates: [{ ...nd[0], dhashDistance: 9 } as (typeof nd)[0]] }),
    );
    expect(far.holds.filter((x) => x.kind === "DUPLICATE_SLIP")).toHaveLength(0);
  });

  it("raises IMPLAUSIBLE_YIELD above 1.6 kg per registered tree; REGISTER_PLOT clears it", () => {
    const m = member("M-053", { registeredTrees: 140 });
    const rows = [row("M-053", 150), row("M-053", 150), row("M-001", 500)];
    const out = computeLines(input([m, member("M-001")], rows));
    const h = holdOf(out, holdKey.yield("M-053"));
    expect(h).toMatchObject({ state: "OPEN", gate: "BLOCKS_APPROVAL" });
    expect(h?.params.kgPerTree).toBe("2.14");
    const plot = { plotNo: "P-053-B", areaHa: "0.60", trees: 330 };
    const fixed = computeLines(
      input([m, member("M-001")], rows, {
        resolutions: [
          { holdKey: holdKey.yield("M-053"), resolution: "REGISTER_PLOT", plot, by: "AS", at: AT },
        ],
      }),
    );
    expect(holdOf(fixed, holdKey.yield("M-053"))).toMatchObject({ state: "RESOLVED" });
    expect(holdOf(fixed, holdKey.yield("M-053"))?.params.kgPerTreeAfter).toBe("0.64");
    const tooSmall = computeLines(
      input([m, member("M-001")], rows, {
        resolutions: [
          {
            holdKey: holdKey.yield("M-053"),
            resolution: "REGISTER_PLOT",
            plot: { ...plot, trees: 10 },
            by: "AS",
            at: AT,
          },
        ],
      }),
    );
    expect(holdOf(tooSmall, holdKey.yield("M-053"))?.state).toBe("OPEN");
    expect(
      computeLines(input([member("M-001", { registeredTrees: 1 })], [row("M-001", 1.6)])).holds.filter(
        (x) => x.kind === "IMPLAUSIBLE_YIELD",
      ),
    ).toHaveLength(0);
  });

  it("audits box-13 marks: ruled hauling stays, unruled multa raises NO_RULE and can return as a credit", () => {
    const marks = [
      {
        markId: "m1",
        text: "Hauling ₱91.20",
        ruleId: "R2" as const,
        writtenCentavos: 9_120,
        documentRef: null,
      },
      {
        markId: "m2",
        text: "Multa (absent GA) ₱200",
        ruleId: "NO_MATCH" as const,
        writtenCentavos: 20_000,
        documentRef: null,
      },
    ];
    const rows = [row("M-018", 60.8, { serial: "0458", station: "PUROK_2", marks }), row("M-001", 939.2)];
    const members = [member("M-018", { rail: "PAYPAL" }), member("M-001")];
    const out = computeLines(input(members, rows));
    const h = holdOf(out, holdKey.noRule("m2"));
    expect(h).toMatchObject({ kind: "NO_RULE", gate: "RESERVES_LINE", state: "OPEN" });
    expect(h?.params.stays).toEqual(["Hauling ₱91.20 (R2)"]);
    expect(h?.params.creditCents).toBe(320);
    expect(out.holds.some((x) => x.kind === "RATE_MISMATCH")).toBe(false);
    expect(line(out, "M-018").state).toBe("HELD");
    expect(out.approvalBlocked).toBe(false);
    expect(out.conservation.carriedNetCents).toBe(line(out, "M-018").netCents);

    const credited = computeLines(
      input(members, rows, {
        resolutions: [{ holdKey: holdKey.noRule("m2"), resolution: "RETURN_AS_CREDIT", by: "AS", at: AT }],
      }),
    );
    expect(line(credited, "M-018").creditsCents).toBe(320);
    expect(line(credited, "M-018").netCents - line(out, "M-018").netCents).toBe(320);
    expect(line(credited, "M-018").state).toBe("READY");
    expect(credited.conservation.balanced).toBe(true);

    const applied = computeLines(
      input(members, rows, {
        resolutions: [
          { holdKey: holdKey.noRule("m2"), resolution: "APPLY_RULE", ruleId: "R2", by: "AS", at: AT },
        ],
      }),
    );
    expect(holdOf(applied, holdKey.noRule("m2"))?.state).toBe("RESOLVED");
    expect(holdOf(applied, holdKey.rateMismatch("m2"))?.state).toBe("OPEN");
  });

  it("raises RATE_MISMATCH for wrong hauling, a CBU mark at the bodega, or a loan without an ATD", () => {
    const rules = TEST_RULES;
    const r = { netG: 60_800, station: "PUROK_2" as const };
    const m = {
      loans: [{ ref: "ATD-1", outstandingCentavos: 10_000, authorityToDeduct: true }],
      advances: [{ voucherNo: "CA-1", outstandingCentavos: 5_000 }],
    };
    expect(checkRuledMark("R2", 9_120, null, r, m, rules)).toMatchObject({ ok: true });
    expect(checkRuledMark("R2", 9_500, null, r, m, rules)).toMatchObject({
      ok: false,
      allowedCentavos: 9_120,
    });
    expect(checkRuledMark("R2", 9_120, null, { ...r, station: "BODEGA" }, m, rules)).toMatchObject({
      ok: false,
    });
    expect(checkRuledMark("R1", 100, null, r, m, rules)).toMatchObject({
      ok: false,
      reason: "CBU_IS_TAKEN_AT_PAY_TIME",
    });
    expect(checkRuledMark("R3", 5_000, "ATD-1", r, m, rules)).toMatchObject({ ok: true });
    expect(checkRuledMark("R3", 5_000, "ATD-9", r, m, rules)).toMatchObject({ ok: false });
    expect(checkRuledMark("R4", 6_000, "CA-1", r, m, rules)).toMatchObject({
      ok: false,
      reason: "OVER_OUTSTANDING",
    });
    expect(checkRuledMark("R4", 5_000, null, r, m, rules)).toMatchObject({ ok: true });
    expect(checkRuledMark("R2", null, null, r, m, rules)).toMatchObject({ ok: false });
    expect(checkRuledMark("R5", 1, null, r, m, rules)).toMatchObject({ ok: false });

    const marks = [
      { markId: "cbu", text: "CBU ₱50", ruleId: "R1" as const, writtenCentavos: 5_000, documentRef: null },
    ];
    const members = [member("M-001")];
    const out = computeLines(input(members, [row("M-001", 50, { marks })]));
    expect(holdOf(out, holdKey.rateMismatch("cbu"))).toMatchObject({ state: "OPEN", gate: "RESERVES_LINE" });
    const back = computeLines(
      input(members, [row("M-001", 50, { marks })], {
        resolutions: [
          { holdKey: holdKey.rateMismatch("cbu"), resolution: "RETURN_AS_CREDIT", by: "AS", at: AT },
        ],
      }),
    );
    expect(line(back, "M-001").creditsCents).toBe(80);
  });

  it("quarantines instruction-like text; a hold only when it overlaps data", () => {
    const anomaly = (overlap: "NONE" | "FIELD" | "KILO_FIELD" | "UNLOCATED") => [
      {
        anomalyId: "a1",
        kind: "INSTRUCTION_LIKE_TEXT" as const,
        quarantined: true,
        overlap,
        source: "read_a" as const,
      },
    ];
    const members = [member("M-001")];
    const none = computeLines(
      input(members, [row("M-001", 40, { serial: "0449", anomalies: anomaly("NONE") })]),
    );
    expect(none.quarantines).toHaveLength(1);
    expect(none.quarantines[0]).toMatchObject({ serial: "0449", hold: false });
    expect(none.holds.filter((h) => h.kind === "SUSPECTED_INJECTION")).toHaveLength(0);
    const field = computeLines(
      input(members, [row("M-001", 40, { serial: "0449", anomalies: anomaly("FIELD") })]),
    );
    expect(field.holds.find((h) => h.kind === "SUSPECTED_INJECTION")).toMatchObject({
      kind: "SUSPECTED_INJECTION",
      gate: "RESERVES_LINE",
    });
    const kilo = computeLines(
      input(members, [row("M-001", 40, { serial: "0449", anomalies: anomaly("KILO_FIELD") })]),
    );
    expect(kilo.holds.find((h) => h.kind === "SUSPECTED_INJECTION")).toMatchObject({
      gate: "BLOCKS_APPROVAL",
    });
    const unlocated = computeLines(
      input(members, [row("M-001", 40, { serial: "0449", anomalies: anomaly("UNLOCATED") })]),
    );
    expect(unlocated.holds.find((h) => h.kind === "SUSPECTED_INJECTION")).toMatchObject({
      gate: "RESERVES_LINE",
    });
  });

  it("holds unentered kilos (By hand), keeps the dial pending, then reports the hold cleared", () => {
    const pending = row("M-060", 64.5, {
      serial: "0462",
      payableG: null,
      netG: null,
      pendingFields: [
        { fieldId: "f1", field: "gross_kg", score: 0.4 },
        { fieldId: "f2", field: "net_kg", score: 0.4 },
      ],
    });
    const members = [member("M-060"), member("M-001")];
    const read = computeLines(input(members, [pending, row("M-001", 940)]));
    const key = holdKey.lowConfidence(pending.rowId);
    expect(holdOf(read, key)).toMatchObject({
      kind: "LOW_CONFIDENCE",
      gate: "BLOCKS_APPROVAL",
      state: "OPEN",
    });
    expect(read.massBalance.status).toBe("PENDING");
    expect(read.approvalBlocked).toBe(true);
    const prior = read.holds.map((h) => ({ key: h.key, kind: h.kind, gate: h.gate, memberNo: h.memberNo }));
    const entered = { ...pending, payableG: 64_500, netG: 64_500, pendingFields: [], enteredByHand: true };
    const after = computeLines(input(members, [entered, row("M-001", 940)], { priorHolds: prior }));
    expect(holdOf(after, key)).toMatchObject({ state: "RESOLVED", resolution: { kind: "ENTERED_BY_HAND" } });
    expect(after.massBalance.status).not.toBe("PENDING");

    const nameOnly = row("M-001", 10, {
      pendingFields: [{ fieldId: "n", field: "member_name", score: 0.4 }],
    });
    const reserved = computeLines(input([member("M-001")], [nameOnly]));
    expect(reserved.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.gate).toBe("RESERVES_LINE");
    const confirmed = computeLines(
      input([member("M-001")], [nameOnly], {
        resolutions: [
          { holdKey: holdKey.lowConfidence(nameOnly.rowId), resolution: "CONFIRM_AS_READ", by: "AS", at: AT },
        ],
      }),
    );
    expect(confirmed.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.state).toBe("RESOLVED");
  });

  it("raises MASS_BALANCE outside ±2.0% and clears it when back inside", () => {
    const members = [member("M-001")];
    const outside = computeLines(input(members, [row("M-001", 1_021)])); // +2.1%
    expect(outside.massBalance).toMatchObject({ status: "OUTSIDE", shrinkBp: 210 });
    expect(holdOf(outside, holdKey.massBalance())).toMatchObject({
      state: "OPEN",
      gate: "BLOCKS_APPROVAL",
      memberNo: null,
    });
    const edge = computeLines(input(members, [row("M-001", 1_020)])); // exactly +2.0% passes
    expect(edge.massBalance.status).toBe("INSIDE");
    const prior = outside.holds.map((h) => ({
      key: h.key,
      kind: h.kind,
      gate: h.gate,
      memberNo: h.memberNo,
    }));
    const inside = computeLines(input(members, [row("M-001", 1_010)], { priorHolds: prior }));
    expect(holdOf(inside, holdKey.massBalance())).toMatchObject({
      state: "RESOLVED",
      resolution: { kind: "ENGINE_CLEARED" },
    });
    expect(inside.approvalBlocked).toBe(false);
  });

  it("ignores resolutions that do not apply to the hold kind", () => {
    const rows = [
      row("M-001", 42, { serial: "0457" }),
      row("M-001", 42, { serial: "0457", copy: "PINK_DUPLICATE", rowId: "p" }),
    ];
    const out = computeLines(
      input([member("M-001")], rows, {
        resolutions: [
          { holdKey: holdKey.duplicate("0457"), resolution: "RETURN_AS_CREDIT", by: "AS", at: AT },
        ],
      }),
    );
    expect(holdOf(out, holdKey.duplicate("0457"))?.state).toBe("OPEN");
    expect(isResolutionAllowed("DUPLICATE_SLIP", "RETURN_AS_CREDIT")).toBe(false);
    expect(isResolutionAllowed("NO_RULE", "RETURN_AS_CREDIT")).toBe(true);
    expect(ALLOWED_RESOLUTIONS.MASS_BALANCE).toEqual([]);
    expect(isOverride("DUPLICATE_SLIP", "TWO_DELIVERIES")).toBe(true);
    expect(isOverride("RATE_MISMATCH", "CONFIRM_AS_READ")).toBe(true);
    expect(isOverride("LOW_CONFIDENCE", "CONFIRM_AS_READ")).toBe(false);
    expect(isOverride("DUPLICATE_SLIP", "COUNT_ONCE")).toBe(false);
  });
});

describe("line hashes", () => {
  it("recompute and change with any figure", () => {
    const out = computeLines(
      input([member("M-001"), member("M-002")], [row("M-001", 600), row("M-002", 400)]),
    );
    const l = line(out, "M-001");
    const { lineSha256: h, ...rest } = l;
    expect(lineSha256(rest, input([], []).card.sha256)).toBe(h);
    expect(lineSha256({ ...rest, netCents: rest.netCents + 1 }, input([], []).card.sha256)).not.toBe(h);
  });
});

describe("inv.i3.conservation", () => {
  const arbWorld = fc
    .record({
      n: fc.integer({ min: 1, max: 12 }),
      kilos: fc.array(fc.integer({ min: 0, max: 400_000 }), { minLength: 1, maxLength: 30 }),
      g2: fc.array(fc.boolean(), { minLength: 30, maxLength: 30 }),
      rails: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
      paidUp: fc.array(fc.integer({ min: 0, max: 600_000 }), { minLength: 12, maxLength: 12 }),
      loans: fc.array(fc.integer({ min: 0, max: 200_000 }), { minLength: 12, maxLength: 12 }),
      advances: fc.array(fc.integer({ min: 0, max: 200_000 }), { minLength: 12, maxLength: 12 }),
      trees: fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 12, maxLength: 12 }),
      multa: fc.option(fc.integer({ min: 0, max: 100_000 })),
      returnIt: fc.boolean(),
      shippedKg: fc.integer({ min: 1, max: 20_000 }),
    })
    .map((w) => {
      const members = Array.from({ length: w.n }, (_, i) =>
        member(`M-${String(i + 1).padStart(3, "0")}`, {
          rail: w.rails[i] ? "PAYPAL" : "CASH",
          cbuPaidUpCentavos: w.paidUp[i] ?? 0,
          registeredTrees: w.trees[i] ?? 0,
          loans: [{ ref: `ATD-${i}`, outstandingCentavos: w.loans[i] ?? 0, authorityToDeduct: true }],
          advances: [{ voucherNo: `CA-${i}`, outstandingCentavos: w.advances[i] ?? 0 }],
        }),
      );
      const rows = w.kilos.map((g, k) =>
        row(`M-${String((k % w.n) + 1).padStart(3, "0")}`, g / 1000, {
          serial: String(301 + k).padStart(4, "0"),
          rowId: `r${k}`,
          grade: w.g2[k] ? "G2" : "G1",
          marks:
            k === 0 && w.multa !== null
              ? [
                  {
                    markId: "mk",
                    text: "Multa",
                    ruleId: "NO_MATCH",
                    writtenCentavos: w.multa,
                    documentRef: null,
                  },
                ]
              : [],
        }),
      );
      const ok =
        rows.some((r) => (r.payableG ?? 0) > 0) &&
        rows.some((r) => r.grade === "G1" && (r.payableG ?? 0) > 0);
      return {
        ok,
        input: input(members, rows, {
          lot: {
            lotCode: "L",
            shippedG: w.shippedKg * 1000,
            grade1ShippedG: w.shippedKg * 900,
            sacks: 1,
            sackKind: "jute",
            shippedOn: "2026-09-18",
          },
          resolutions:
            w.multa !== null && w.returnIt
              ? [{ holdKey: holdKey.noRule("mk"), resolution: "RETURN_AS_CREDIT", by: "AS", at: AT }]
              : [],
        }),
      };
    });

  it("money is conserved to the cent for any world (fast-check)", () => {
    fc.assert(
      fc.property(arbWorld, ({ ok, input: inp }) => {
        fc.pre(ok);
        const out = computeLines(inp, { validate: false });
        const c = out.conservation;
        expect(c.balanced).toBe(true);
        expect(c.premiumSumCents).toBe(c.premiumPoolCents);
        expect(c.bonusSumCents).toBe(c.bonusPoolCents);
        expect(c.netCents + c.deductionsCents - c.creditsCents).toBe(c.poolCents);
        expect(c.onRailNetCents + c.offRailNetCents + c.carriedNetCents).toBe(c.netCents);
        for (const l of out.lines) {
          expect(Number.isSafeInteger(l.netCents)).toBe(true);
          expect(l.deductionsCents).toBeLessThanOrEqual(l.bonusCents);
          expect(l.netCents).toBeGreaterThanOrEqual(l.premiumCents);
        }
        expect(conserve(out.lines, c.premiumPoolCents, c.bonusPoolCents)).toEqual(c);
      }),
      { numRuns: 150 },
    );
  });
});
