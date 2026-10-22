import { describe, expect, it } from "vitest";
import * as format from "./format.js";

const FX = { num: 125, den: 2 };

describe("format (deterministic, no Intl, C-22)", () => {
  it("prints US dollars and pesos", () => {
    expect(format.money(433_350)).toBe("US$4,333.50");
    expect(format.money(6_445)).toBe("US$64.45");
    expect(format.money(-109)).toBe("−US$1.09");
    expect(format.money(5)).toBe("US$0.05");
    expect(format.money(402_812, "PHP")).toBe("₱4,028.12");
    expect(format.amount(4_369)).toBe("43.69");
    expect(format.amount(-109)).toBe("−1.09");
    expect(format.groupThousands("1234567")).toBe("1,234,567");
  });

  it("labels every peso figure as an estimate, in the member's language", () => {
    expect(format.pesoEstimate(6_445, FX, "ceb")).toBe("mga ₱4,028 (gibanabana)");
    expect(format.pesoEstimate(6_445, FX, "fil")).toBe("humigit-kumulang ₱4,028 (tantiya)");
    expect(format.pesoEstimate(6_445, FX, "en")).toBe("about ₱4,028 (estimate)");
    expect(format.pesoEstimate(12_784, FX, "en")).toBe("about ₱7,990 (estimate)");
    expect(format.pesoEstimate(433_350, FX, "en")).toBe("about ₱270,844 (estimate)");
    expect(format.pesoWhole(9_120)).toBe("₱91");
    expect(format.pesoValueOf(-6_445, FX)).toBe(-4_028);
  });

  it("prints kilos, slip boxes and rates", () => {
    expect(format.kg(148_000)).toBe("148.0 kg");
    expect(format.kg(9_780_600)).toBe("9,780.6 kg");
    expect(format.kg(9_625_000, 0)).toBe("9,625 kg");
    expect(format.kgNumber(1_600, 1)).toBe("1.6");
    expect(format.slipKg(38_450)).toBe("38.45");
    expect(format.slipKg(300)).toBe("0.30");
    expect(format.ratePerKg(288_750, 9_780_600)).toBe("US$0.29523 a kg");
    expect(format.kgPerTree(300_000, 140)).toBe("2.14");
    expect(format.kgPerTree(300_000, 470)).toBe("0.64");
    expect(format.kgPerTree(1, 0)).toBe("∞");
    expect(() => format.ratePerKg(1, 0)).toThrow(RangeError);
  });

  it("prints percentages", () => {
    expect(format.percent(155_600, 9_625_000)).toBe("1.62%");
    expect(format.percent(197_600, 9_625_000)).toBe("2.05%");
    expect(format.percent(-155_600, 9_625_000)).toBe("−1.62%");
    expect(format.percentBp(162)).toBe("1.62%");
    expect(format.percentBp(200, 1)).toBe("2.0%");
    expect(format.shareOf(34_174, 421_817)).toBe("8.1%");
    expect(() => format.percent(1, 0)).toThrow(RangeError);
  });

  it("groups hashes in fours", () => {
    const h = "7f3a91c2deadbeef";
    expect(format.hashGroups(h)).toBe("7f3a 91c2");
    expect(format.hashAllGroups(h)).toBe("7f3a 91c2 dead beef");
  });

  it("prints dates and times in en, ceb and fil", () => {
    expect(format.date("2026-10-30", "en")).toBe("30 Oct 2026");
    expect(format.date("2026-10-30", "ceb")).toBe("30 Okt 2026");
    expect(format.date("2026-01-02", "fil")).toBe("2 Ene 2026");
    expect(format.dateShort("2026-04-02")).toBe("2 Apr");
    expect(format.time("2026-10-29T02:21:41.000Z")).toBe("10:21:41");
    expect(format.time("2026-10-29T02:21:41.000Z", 0)).toBe("02:21:41");
    expect(format.addDays("2026-10-29", 25)).toBe("2026-11-23");
    expect(format.addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(() => format.date("30/10/2026")).toThrow(RangeError);
    expect(() => format.time("nope")).toThrow(RangeError);
  });

  it("prints elapsed time", () => {
    expect(format.elapsedClock(14_000)).toBe("0:14");
    expect(format.elapsedClock(723_000)).toBe("12:03");
    expect(format.elapsedWords(192_000)).toBe("3 min 12 s");
    expect(format.elapsedWords(45_000)).toBe("45 s");
    expect(format.elapsedWords(3_720_000)).toBe("1 h 2 min");
  });

  it("speaks amounts in full phrases", () => {
    expect(format.numberWords(4_028)).toBe("four thousand twenty-eight");
    expect(format.numberWords(270_844)).toBe("two hundred seventy thousand eight hundred forty-four");
    expect(format.numberWords(0)).toBe("zero");
    expect(format.numberWords(1_000_000)).toBe("one million");
    expect(format.amountSpoken(6_445, "en", FX)).toBe(
      "sixty-four dollars and forty-five cents, about four thousand twenty-eight pesos, estimate",
    );
    expect(format.amountSpoken(36_839, "en")).toBe("three hundred sixty-eight dollars and thirty-nine cents");
    expect(format.amountSpoken(100, "ceb", FX)).toBe("one dollar, mga sixty-three pesos, gibanabana");
    expect(format.amountSpoken(1, "fil")).toBe("one cent");
    expect(format.amountSpoken(-50, "en")).toBe("minus fifty cents");
    expect(format.digitsSpoken("0403")).toBe("zero four zero three");
    expect(() => format.numberWords(-1)).toThrow(RangeError);
  });

  it("formats identifiers and DTOs", () => {
    expect(format.memberNo(14)).toBe("M-014");
    expect(format.serial(403)).toBe("0403");
    expect(format.maskEmail("nangceling@members.example")).toBe("n***@members.example");
    expect(format.maskEmail("bad")).toBe("***");
    expect(format.moneyDTO(6_445)).toEqual({ cents: 6_445, currency: "USD", display: "US$64.45" });
    expect(format.kgDTO(148_000)).toEqual({ grams: 148_000, display: "148.0 kg" });
  });
});
