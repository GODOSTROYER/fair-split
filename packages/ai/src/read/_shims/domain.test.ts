import { describe, expect, it } from "vitest";
import {
  AUTO_ACCEPT_AT,
  agreement,
  isAutoAccepted,
  jaroWinkler,
  mergeDisplay,
  normaliseDeduction,
  normaliseField,
  rowCheckFailures,
  type ScoredRead,
  validateField,
} from "./domain.js";

const read = (raw: string, legibility: ScoredRead["legibility"] = "CLEAR", valid = true): ScoredRead => ({
  legibility,
  raw,
  norm: raw && !raw.includes("?") ? { key: raw.replace(/^0+/, ""), value: raw } : null,
  valid: valid && !!raw && !raw.includes("?"),
});

describe("agreement table (S4.2; register AI-2 gate)", () => {
  it("row 1: either read ILLEGIBLE → 0, a person types", () => {
    expect(agreement(read("38.45"), read("", "ILLEGIBLE"))).toMatchObject({
      score: 0,
      rule: 1,
      state: "PERSON_TYPES",
    });
  });
  it("row 1: a required field ABSENT → 0", () => {
    expect(agreement(read("", "ABSENT"), read("38.45"))).toMatchObject({ score: 0, rule: 1 });
  });
  it("an optional field ABSENT in both reads is skipped", () => {
    expect(agreement(read("", "ABSENT"), read("", "ABSENT"), undefined, { required: false })).toBeNull();
  });
  it("row 2: either read OVERWRITTEN → 0.60, a person always", () => {
    expect(agreement(read("42.10", "OVERWRITTEN"), read("42.10"))).toMatchObject({
      score: 0.6,
      rule: 2,
      state: "PERSON_TYPES",
    });
  });
  it("row 3: A = B, both CLEAR, checks pass → 0.97 auto-accept", () => {
    const o = agreement(read("38.45"), read("38.45"));
    expect(o).toMatchObject({
      score: 0.97,
      rule: 3,
      state: "AUTO_ACCEPTED",
      decidedBy: "agreement",
      value: "38.45",
    });
    expect(isAutoAccepted(o)).toBe(true);
  });
  it("row 4: A = B with exactly one SMUDGED → 0.88 auto-accept", () => {
    expect(agreement(read("38.45", "SMUDGED"), read("38.45"))).toMatchObject({
      score: 0.88,
      rule: 4,
      state: "AUTO_ACCEPTED",
    });
  });
  it("row 5: A ≠ B, both SMUDGED, or a failed check → 0.40 and a zoom", () => {
    expect(agreement(read("38.45"), read("38.46"))).toMatchObject({
      score: 0.4,
      rule: 5,
      state: "NEEDS_ZOOM",
    });
    expect(agreement(read("38.45", "SMUDGED"), read("38.45", "SMUDGED"))).toMatchObject({ rule: 5 });
    expect(agreement(read("38.45", "CLEAR", false), read("38.45"))).toMatchObject({ rule: 5 });
  });
  it("row 6: the zoom is CLEAR, valid and equal to A or B → 0.80, one tap confirms", () => {
    const o = agreement(read("38.45"), read("38.46"), read("38.46"));
    expect(o).toMatchObject({ score: 0.8, rule: 6, state: "ONE_TAP", decidedBy: "zoom", value: "38.46" });
    expect(o && o.score >= AUTO_ACCEPT_AT).toBe(false);
  });
  it("row 7: any other zoom → 0.40, a person types", () => {
    expect(agreement(read("38.45"), read("38.46"), read("38.47"))).toMatchObject({ score: 0.4, rule: 7 });
    expect(agreement(read("38.45"), read("38.46"), read("38.46", "SMUDGED"))).toMatchObject({ rule: 7 });
  });
  it("the slip 0462 example: both reads 6?.80 SMUDGED, the zoom cannot resolve → 0.40 and display 6?.80", () => {
    const o = agreement(read("6?.80", "SMUDGED"), read("6?.80", "SMUDGED"), read("6?.80", "SMUDGED"));
    expect(o).toMatchObject({ score: 0.4, rule: 7, display: "6?.80" });
  });
});

describe("mergeDisplay", () => {
  it("puts ? wherever the reads differ or either has ?", () => {
    expect(mergeDisplay("64.80", "63.80")).toBe("6?.80");
    expect(mergeDisplay("6?.80", "64.80")).toBe("6?.80");
    expect(mergeDisplay("64.8", "64.80")).toBe("64.8?");
  });
});

describe("normalisers (S4.2 table)", () => {
  it.each([
    ["serial", "No. 457", "0457"],
    ["serial", "0457", "0457"],
    ["date", "7/14/26", "2026-07-14"],
    ["date", "07/14/2026", "2026-07-14"],
    ["date", "2026-07-14", "2026-07-14"],
    ["member_no", "m-14", "M-014"],
    ["member_no", "M014", "M-014"],
    ["member_name", 'Nang Consolacion "Celing" Bacus', "CONSOLACION BACUS"],
    ["plot_no", "p-053-b", "P-053-B"],
    ["sacks", "3pp", "3 PP"],
    ["gross_kg", "38,45 kg", "38.45"],
    ["net_kg", "60.8", "60.80"],
    ["mc_pct", "7.5%", "7.5"],
    ["grade", "I", "G1"],
    ["grade", "II", "G2"],
    ["grade", "off", "OFF"],
  ] as const)("%s %j → %j", (f, raw, value) => {
    expect(normaliseField(f, raw)?.value).toBe(value);
  });
  it("kilos become exact integer grams", () => {
    expect(normaliseField("gross_kg", "38.45")?.n).toBe(38450);
    expect(normaliseField("gross_kg", "0.3")?.n).toBe(300);
  });
  it.each([
    ["gross_kg", "6?.80"],
    ["gross_kg", "1234.5"],
    ["date", "2/30/26"],
    ["sacks", "many"],
    ["mc_pct", "abc"],
    ["grade", "G3"],
  ] as const)("%s %j does not normalise", (f, raw) => {
    expect(normaliseField(f, raw)).toBeNull();
  });
  it("deductions: trimmed, spaces collapsed, P/PHP → ₱", () => {
    expect(normaliseDeduction("  Hauling   P 91.20 ")).toBe("Hauling ₱91.20");
    expect(normaliseDeduction("Multa (absent GA) PHP200")).toBe("Multa (absent GA) ₱200");
  });
});

describe("validators", () => {
  const registry = new Map([["M-014", { memberNo: "M-014", name: 'Consolacion "Nang Celing" Bacus' }]]);
  const ctx = { registry, serialRange: { lo: 301, hi: 563 } };
  const v = (f: Parameters<typeof normaliseField>[0], raw: string, member?: string) => {
    const n = normaliseField(f, raw);
    return n ? validateField(f, n, ctx, member) : "unnormalisable";
  };
  it("checks serial pad range, season dates, registry and name similarity", () => {
    expect(v("serial", "0403")).toBeNull();
    expect(v("serial", "0901")).toMatch(/pad range/);
    expect(v("date", "4/1/26")).toBeNull();
    expect(v("date", "9/1/26")).toMatch(/season/);
    expect(v("member_no", "M-014")).toBeNull();
    expect(v("member_no", "M-999")).toMatch(/registry/);
    expect(v("member_name", "CONSOLACION BACUS", "M-014")).toBeNull();
    expect(v("member_name", "MERLYN PONCE", "M-014")).toMatch(/registry/);
    expect(v("gross_kg", "399.99")).toBeNull();
    expect(v("mc_pct", "13.0")).toMatch(/moisture/);
    expect(v("plot_no", "P-53-B")).toMatch(/format/);
  });
  it("row checks: gross − tare = net and net − mc_less = payable within ±10 g", () => {
    expect(
      rowCheckFailures({ gross_kg: 64800, tare_kg: 300, net_kg: 64500, mc_less_kg: 0, payable_kg: 64500 })
        .size,
    ).toBe(0);
    expect(rowCheckFailures({ gross_kg: 64800, tare_kg: 300, net_kg: 64490 }).size).toBe(0);
    expect([...rowCheckFailures({ gross_kg: 64800, tare_kg: 300, net_kg: 64400 })].sort()).toEqual([
      "gross_kg",
      "net_kg",
      "tare_kg",
    ]);
    expect([...rowCheckFailures({ net_kg: 60800, mc_less_kg: 500, payable_kg: 60800 })].sort()).toEqual([
      "mc_less_kg",
      "net_kg",
      "payable_kg",
    ]);
  });
  it("Jaro-Winkler behaves like the reference", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("DIXON", "DICKSONX")).toBeCloseTo(0.813, 3);
    expect(jaroWinkler("", "A")).toBe(0);
  });
});
