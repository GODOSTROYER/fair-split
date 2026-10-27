import type { FieldRead } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import {
  AUTO_ACCEPT,
  agreement,
  deriveKilos,
  fitsPattern,
  jaroWinkler,
  mergeDisplay,
  normalise,
  parseWrittenCentavos,
  rowChecks,
  validate,
} from "./agreement.js";

const r = (
  valueText: string,
  legibility: FieldRead["legibility"] = "CLEAR",
  overwrittenFrom = "",
): FieldRead => ({
  valueText,
  legibility,
  overwrittenFrom,
});

describe("agreement(a, b, zoom?) — AI-2 table (register §9)", () => {
  it("row 1: illegible, or a required field absent → 0, a person types", () => {
    expect(agreement(r("38.45", "ILLEGIBLE"), r("38.45"))).toMatchObject({
      score: 0,
      row: 1,
      outcome: "PERSON",
    });
    expect(agreement(r("", "ABSENT"), r("38.45"))).toMatchObject({ score: 0, row: 1 });
  });

  it("row 2: overwritten → 0.60, always a person", () => {
    expect(agreement(r("38.45", "OVERWRITTEN", "33.45"), r("38.45"))).toMatchObject({
      score: 0.6,
      row: 2,
      autoAccept: false,
    });
  });

  it("row 3: A = B, both clear, checks pass → 0.97 auto-accept", () => {
    expect(agreement(r("38.45"), r("38.45"))).toMatchObject({
      score: 0.97,
      row: 3,
      outcome: "AUTO_ACCEPT",
      autoAccept: true,
      value: "38.45",
    });
  });

  it("row 4: A = B, exactly one smudged → 0.88 auto-accept", () => {
    expect(agreement(r("38.45", "SMUDGED"), r("38.45"))).toMatchObject({
      score: 0.88,
      row: 4,
      autoAccept: true,
    });
  });

  it("row 5: A ≠ B, both smudged, or a failed check → 0.40 and a zoom", () => {
    expect(agreement(r("38.45"), r("33.45"))).toMatchObject({ score: 0.4, row: 5, outcome: "ZOOM" });
    expect(agreement(r("38.45", "SMUDGED"), r("38.45", "SMUDGED"))).toMatchObject({ score: 0.4, row: 5 });
    expect(agreement(r("38.45"), r("38.45"), undefined, { checksPass: false })).toMatchObject({
      score: 0.4,
      row: 5,
    });
  });

  it("rows 6 and 7: after the zoom, one tap confirms at 0.80; otherwise a person types", () => {
    expect(agreement(r("38.45"), r("33.45"), r("38.45"))).toMatchObject({
      score: 0.8,
      row: 6,
      outcome: "CONFIRM_ONE_TAP",
      value: "38.45",
    });
    expect(agreement(r("38.45"), r("33.45"), r("39.45"))).toMatchObject({
      score: 0.4,
      row: 7,
      outcome: "PERSON",
    });
    expect(agreement(r("38.45"), r("33.45"), r("38.45", "SMUDGED"))).toMatchObject({ row: 7 });
    expect(agreement(r("6?.80", "SMUDGED"), r("6?.80", "SMUDGED"), r("6?.80", "SMUDGED"))).toMatchObject({
      score: 0.4,
      row: 7,
      display: "6?.80",
    });
    expect(agreement(r("38.45"), r("33.45"), r("38.45"), { valid: () => false })).toMatchObject({ row: 7 });
  });

  it("skips an optional field absent in both reads; auto-accept needs 0.85", () => {
    expect(agreement(r("", "ABSENT"), r("", "ABSENT"), undefined, { required: false })).toMatchObject({
      row: 0,
      outcome: "SKIPPED",
    });
    expect(AUTO_ACCEPT).toBe(0.85);
  });

  it("compares normalised values", () => {
    const res = agreement(r("38,45 kg"), r("38.45"), undefined, {
      normalise: (v) => {
        const g = normalise.kgGrams(v);
        return g === null ? null : String(g);
      },
    });
    expect(res).toMatchObject({ row: 3, value: "38450" });
  });

  it("merges reads per character for display", () => {
    expect(mergeDisplay("64.80", "61.80")).toBe("6?.80");
    expect(mergeDisplay("6?.80", "64.80")).toBe("6?.80");
    expect(mergeDisplay("4.80", "64.80")).toBe("?4.80");
  });
});

describe("normalisers and validators (S4.2 table)", () => {
  it("normalises each box", () => {
    expect(normalise.serial("No. 457")).toBe("0457");
    expect(normalise.serial("12345")).toBeNull();
    expect(normalise.date("7/3/26")).toBe("2026-07-03");
    expect(normalise.date("07/03/2026")).toBe("2026-07-03");
    expect(normalise.date("2026-07-03")).toBe("2026-07-03");
    expect(normalise.date("2/30/26")).toBeNull();
    expect(normalise.memberNo("m-14")).toBe("M-014");
    expect(normalise.memberNo("X-14")).toBeNull();
    expect(normalise.memberName("Nang Consolacion, Bacus")).toBe("CONSOLACION BACUS");
    expect(normalise.plotNo(" p-053-b ")).toBe("P-053-B");
    expect(normalise.sacks("1 pp")).toBe("1 PP");
    expect(normalise.sacks("jute")).toBe("JUTE");
    expect(normalise.sacks("sack")).toBeNull();
    expect(normalise.kgGrams("38,45 kg")).toBe(38_450);
    expect(normalise.kgGrams("64.5")).toBe(64_500);
    expect(normalise.kgGrams("1234.5")).toBeNull();
    expect(normalise.mcPctTenths("6.5%")).toBe(65);
    expect(normalise.grade("I")).toBe("G1");
    expect(normalise.grade("2")).toBe("G2");
    expect(normalise.grade("off")).toBe("OFF");
    expect(normalise.grade("G3")).toBeNull();
    expect(normalise.deduction("  Multa   (absent GA)  P200 ")).toBe("Multa (absent GA) ₱200");
    expect(normalise.deduction("Hauling PHP 91.20")).toBe("Hauling ₱91.20");
  });

  it("validates each box", () => {
    const w = { opensOn: "2026-04-01", closesOn: "2026-08-31", serialMin: 301, serialMax: 563 };
    expect(validate.serial("0457", w)).toBe(true);
    expect(validate.serial("0600", w)).toBe(false);
    expect(validate.date("2026-07-03", w)).toBe(true);
    expect(validate.date("2026-09-01", w)).toBe(false);
    expect(validate.memberNo("M-014", new Set(["M-014"]))).toBe(true);
    expect(validate.memberNo("M-099", new Set(["M-014"]))).toBe(false);
    expect(validate.memberName("CONSOLACION BACUS", "Consolacion Bacus")).toBe(true);
    expect(validate.memberName("CONSOLASION BACOS", "Consolacion Bacus")).toBe(true);
    expect(validate.memberName("PEDRO OMPAD", "Consolacion Bacus")).toBe(false);
    expect(validate.plotNo("P-053-B")).toBe(true);
    expect(validate.plotNo("P-53-B")).toBe(false);
    expect(validate.sacks("2 PP")).toBe(true);
    expect(validate.sacks("0 PP")).toBe(false);
    expect(validate.kgText("400")).toBe(true);
    expect(validate.kgText("400.01")).toBe(false);
    expect(validate.mcPctTenths(65)).toBe(true);
    expect(validate.mcPctTenths(130)).toBe(false);
    expect(validate.deduction(" ")).toBe(false);
  });

  it("checks rows within ±10 g", () => {
    expect(rowChecks({ grossG: 64_800, tareG: 300, netG: 64_500, mcLessG: 0, payableG: 64_500 })).toEqual({
      grossTareNet: true,
      netMcPayable: true,
    });
    expect(
      rowChecks({ grossG: 64_800, tareG: 300, netG: 64_400, mcLessG: 0, payableG: 64_500 }).grossTareNet,
    ).toBe(false);
  });

  it("scores names with Jaro-Winkler", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("", "A")).toBe(0);
    expect(jaroWinkler("SAME", "SAME")).toBe(1);
    expect(jaroWinkler("ABC", "XYZ")).toBe(0);
  });

  it("parses written amounts (last number, ₱/P/PHP optional)", () => {
    expect(parseWrittenCentavos("Multa (absent GA) ₱200")).toBe(20_000);
    expect(parseWrittenCentavos("Hauling ₱91.20")).toBe(9_120);
    expect(parseWrittenCentavos("less 150")).toBe(15_000);
    expect(parseWrittenCentavos("CA-0192 P1,250.5")).toBe(125_050);
    expect(parseWrittenCentavos("fiesta")).toBeNull();
  });

  it("derives the missing kilo from the other two (by hand)", () => {
    expect(deriveKilos({ grossG: 64_800, tareG: 300 })).toEqual({ grossG: 64_800, tareG: 300, netG: 64_500 });
    expect(deriveKilos({ grossG: 64_800, netG: 64_500 })).toEqual({
      grossG: 64_800,
      tareG: 300,
      netG: 64_500,
    });
    expect(deriveKilos({ tareG: 300, netG: 64_500 })).toEqual({ grossG: 64_800, tareG: 300, netG: 64_500 });
    expect(deriveKilos({ grossG: 64_800 })).toBeNull();
    expect(fitsPattern("64.50", "6?.50")).toBe(true);
    expect(fitsPattern("64.40", "6?.50")).toBe(false);
    expect(fitsPattern("4.50", "6?.50")).toBe(false);
  });
});
