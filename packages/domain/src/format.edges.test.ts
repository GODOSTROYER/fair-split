// Tests that kill mutation-testing survivors (handoff T3) in deterministic formatting (C-22): the amounts
// a member reads and hears (zero has no minus sign, negative pesos keep theirs, spoken amounts across
// scales), the guards, and the ASCII e-mail and UUIDv7 edges.
import { describe, expect, it } from "vitest";
import { isAsciiEmail, requireAsciiEmail } from "./ascii.js";
import * as fmt from "./format.js";
import { uuidv7 } from "./uuid.js";

const FX = { num: 125, den: 2 };

describe("amounts on screen", () => {
  it("zero is never negative; a negative amount always is", () => {
    expect(fmt.money(0)).toBe("US$0.00");
    expect(fmt.amount(0)).toBe("0.00");
    expect(fmt.pesoWhole(0)).toBe("₱0");
    expect(fmt.percent(0, 100)).toBe("0.00%");
    expect(fmt.pesoWhole(-402_812)).toBe("−₱4,028");
    expect(fmt.percent(-1, 100)).toBe("−1.00%");
    expect(fmt.amount(-109)).toBe("−1.09");
  });

  it("peso values keep the sign of the dollar amount, at the fixed rate", () => {
    expect(fmt.pesoValueOf(6_445, FX)).toBe(4_028);
    expect(fmt.pesoValueOf(-6_445, FX)).toBe(-4_028);
    expect(fmt.pesoValueOf(0, FX)).toBe(0);
  });

  it("kilos at every precision, and the slip box without grouping", () => {
    expect(fmt.kgNumber(9_780_600, 3)).toBe("9,780.600");
    expect(fmt.kgNumber(-1_500, 1)).toBe("−1.5");
    expect(fmt.slipKg(1_038_450)).toBe("1038.45");
  });

  it("refuses rates and percentages it cannot compute", () => {
    expect(() => fmt.ratePerKg(1, 0)).toThrow("grams must be positive");
    expect(fmt.ratePerKg(288_750, 1)).toMatch(/^US\$/);
    expect(() => fmt.percent(1, 0)).toThrow("den must be positive");
  });

  it("hashes in groups of four, the whole hash too", () => {
    expect(fmt.hashGroups("7f3a91c2", 3)).toBe("7f3a 91c2");
    expect(fmt.hashAllGroups("7f3a91c2ab")).toBe("7f3a 91c2 ab");
  });
});

describe("amounts in words", () => {
  it.each([
    [19, "nineteen"],
    [20, "twenty"],
    [100, "one hundred"],
    [1_000_000_000, "one billion"],
    [2_000_000_017, "two billion seventeen"],
  ])("%i is %s", (n, words) => {
    expect(fmt.numberWords(n)).toBe(words);
  });

  it("refuses what is not a non-negative integer; says minus for a negative amount", () => {
    expect(() => fmt.numberWords(-1)).toThrow("numberWords takes a non-negative integer");
    expect(fmt.amountSpoken(-6_445, "en")).toBe("minus sixty-four dollars and forty-five cents");
    expect(fmt.amountSpoken(0, "en")).toBe("zero cents");
    expect(fmt.amountSpoken(6_445, "fil", FX)).toBe(
      "sixty-four dollars and forty-five cents, humigit-kumulang four thousand twenty-eight piso, tantiya",
    );
  });
});

describe("dates, times and masks", () => {
  it("dates read from the start of the string only, and name what they refuse", () => {
    expect(() => fmt.date("x2026-10-30")).toThrow("not an ISO date: x2026-10-30");
    expect(fmt.date("2026-10-30")).toBe("30 Oct 2026");
    expect(() => fmt.time("noon")).toThrow("not an ISO date-time: noon");
  });

  it("elapsed words switch units at exactly 60 s and 1 h", () => {
    expect(fmt.elapsedWords(60_000)).toBe("1 min 0 s");
    expect(fmt.elapsedWords(3_600_000)).toBe("1 h 0 min");
  });

  it("an e-mail with nothing before the @ is fully masked", () => {
    expect(fmt.maskEmail("@x.example")).toBe("***");
    expect(fmt.maskEmail("a@x.example")).toBe("a***@x.example");
  });
});

describe("ASCII e-mails and UUIDv7", () => {
  it("an address of exactly 254 characters is one; 255 is not", () => {
    const at = (n: number) => `${"a".repeat(n - "@example.test".length)}@example.test`;
    // a dot-atom local part may be long here: the length check is the edge under test
    expect(isAsciiEmail(at(254))).toBe(true);
    expect(isAsciiEmail(at(255))).toBe(false);
  });

  it("a setting with surrounding whitespace says so", () => {
    expect(() => requireAsciiEmail("PP_PAYER_EMAIL", " a@b.example ")).toThrow(
      "PP_PAYER_EMAIL is not a plain ASCII e-mail address (it has surrounding whitespace)",
    );
    expect(() => requireAsciiEmail("PP_PAYER_EMAIL", "a b@c.example")).toThrow(
      /^PP_PAYER_EMAIL is not a plain ASCII e-mail address$/,
    );
  });

  it("uuidv7 takes 0 to 2^48 - 1 milliseconds and carries its seed's bits", () => {
    expect(uuidv7(0, "s")).toMatch(/^00000000-0000-7/);
    expect(() => uuidv7(2 ** 48, "s")).toThrow("timestamp out of range");
    expect(uuidv7(2 ** 48 - 1, "s")).toMatch(/^ffffffff-ffff-7/);
    // sha256("a") = ca978112ca1b…: rand_a "ca9", variant 8|(7&3) = b, rand_b from hex digits 4-18
    expect(uuidv7(1, "a")).toBe("00000000-0001-7ca9-b811-2ca1bbdcafac");
    expect(uuidv7(1, "a").split("-")[3]).toMatch(/^[89ab]/);
  });
});
