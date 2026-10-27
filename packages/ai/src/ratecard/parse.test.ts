import { describe, expect, it } from "vitest";
import { parseCap, parseConfidence, parseKgPerTree, parsePercent, parsePeso, parseUsd } from "./parse.js";

/**
 * Property tests for the S4.3 re-parse (seeded, so a failure reproduces): a typed value is always a
 * whole number as written, never part of a longer one, and never one with a minus sign before it.
 */

/** mulberry32: a small seeded PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const digits = (r: Rand, n: number) => Array.from({ length: n }, () => String(int(r, 0, 9))).join("");

/** An amount in hundredths as a person might write it: grouped or not, 0 to 2 decimals. */
function writeHundredths(r: Rand, hundredths: number, opts: { group: boolean }): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  const intText = opts.group && r() < 0.5 ? whole.toLocaleString("en-US") : String(whole);
  const two = String(frac).padStart(2, "0");
  if (frac === 0) return intText + pick(r, ["", ".0", ".00"]);
  if (frac % 10 === 0) return intText + pick(r, [`.${two[0]}`, `.${two}`]);
  return `${intText}.${two}`;
}

/** The value of a whole numeric run, read strictly (null when the run is not a well-formed number). */
function hundredthsOf(run: string, grouped: boolean): number | null {
  const re = grouped ? /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)(?:\.(\d{1,2}))?$/;
  const m = re.exec(run);
  if (!m?.[1]) return null;
  return Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
const strict = {
  peso: (run: string) => hundredthsOf(run, true),
  usd: (run: string) => hundredthsOf(run, true),
  percent: (run: string) => hundredthsOf(run, false),
  kg: (run: string) => {
    const h = hundredthsOf(run, false);
    return h !== null && h % 10 === 0 ? h / 10 : null;
  },
  /** A fraction ("0.85", ".85", "1") or a percentage ("1.0" before a "%" is 100): either reading explains. */
  confidence: (run: string): Array<number | null> => {
    const pct = strict.percent(run);
    if (!/^(0?\.\d{1,4}|1(?:\.0{1,4})?)$/.test(run)) return [pct];
    const [i, f = ""] = run.split(".");
    return [Number(i || "0") * 10000 + Number(f.padEnd(4, "0")), pct];
  },
};
type Read = (run: string) => number | null | Array<number | null>;

/**
 * "-5%", "−₱200", "- 5%" at the start: a minus sign before the value (after its marker is skipped).
 * "CBU - 5%": a dash with spaces on both sides after other text is punctuation between words. The
 * marker is skipped before trailing spaces are, so the space after such a dash is still seen.
 */
function signedNegative(s: string, at: number, marker: RegExp): boolean {
  const head = s.slice(0, at).replace(marker, "");
  const t = head.trimEnd();
  if (!/[-−–]$/.test(t)) return false;
  return !(t.length < head.length && /\S\s+[-−–]$/.test(t));
}

/**
 * The oracle: a parsed value must be the strict value of one maximal numeric run of the input (digits
 * with "," or "." only between digits, so "12.505" is one run), with no minus sign before it.
 */
function explained(s: string, value: number, read: Read, marker: RegExp, leadingDot = false): boolean {
  const runs = s.matchAll(leadingDot ? /\.?\d+(?:[.,]\d+)*/g : /\d+(?:[.,]\d+)*/g);
  for (const m of runs) {
    if ([read(m[0])].flat().includes(value) && !signedNegative(s, m.index, marker)) return true;
  }
  return false;
}

/** A value's marker and the spaces between it and the digits (none for kilos: nothing to skip). */
const MONEY_MARK = /(?:₱|PHP|P|US\$|USD|\$)\s*$/;
const SIGN_MARK = /(?:±|\+\/-)\s*$/;
const NO_MARK = /(?!)/;

describe("ratecard re-parse: a value is a whole number as written (S4.3, security)", () => {
  it("never reads part of a longer number, and never a value with a minus sign before it", () => {
    // The automated review's cases: each used to come back as a typed value.
    expect(parsePercent("12.505%")).toBeNull(); // was 50500 (read as "505%")
    expect(parsePercent("1,000%")).toBeNull(); // was 0 (read as "000%")
    expect(parsePeso("₱1,5000")).toBeNull(); // was 150000 (read as "₱1,500")
    expect(parsePeso("₱1.505 per kilo")).toBeNull(); // was 150
    expect(parseUsd("US$300.255")).toBeNull(); // was 30025
    expect(parseKgPerTree("1.65 kg per registered tree")).toBeNull(); // was 650 (read as "65 kg")
    expect(parseKgPerTree("1,6 kg")).toBeNull(); // was 60
    expect(parsePercent("5–10%")).toBeNull(); // a range, was 1000
    expect(parsePercent("-5%")).toBeNull();
    expect(parsePercent("− 5 percent")).toBeNull();
    expect(parsePeso("-₱200")).toBeNull();
    expect(parsePeso("(-P 1.50) per kilo")).toBeNull();
    expect(parseUsd("-US$300")).toBeNull();
    expect(parseKgPerTree("-1.6 kg")).toBeNull();
    expect(parseConfidence("-0.85")).toBeNull();
    expect(parseConfidence("0.855")).toBe(8550);
    expect(parseConfidence("0.85555")).toBeNull();
    expect(parseConfidence("1.5")).toBeNull();
    expect(parseCap("₱5,0000")).toEqual({
      ok: false,
      reason: 'cap "₱5,0000" is not exactly one percentage or amount',
    });
    expect(parsePeso("₱99999999999999999")).toBeNull(); // not a safe integer of centavos
    // Digits touching the value, a sign after the marker, a range written with spaces.
    expect(parsePeso("₱1 500")).toBeNull(); // a space-grouped thousand, never ₱1.00
    expect(parsePercent("1 500%")).toBeNull();
    expect(parsePeso("P5M")).toBeNull(); // five million, never ₱5.00
    expect(parsePeso("₱-200")).toBeNull();
    expect(parseUsd("US$ −300")).toBeNull();
    expect(parsePercent(".85%")).toBeNull(); // 0.85%, never 85%
    expect(parsePercent("R25%")).toBeNull();
    expect(parsePercent("5 - 10%")).toBeNull();
    expect(parsePercent("CBU -5%")).toBeNull();
    expect(parseKgPerTree("x1.6 kg")).toBeNull();
    // A confidence is the only number written: "0.85 (85%)" is two, and so is R6's whole clause.
    expect(parseConfidence("0.85 (85%)")).toBeNull();
    expect(
      parseConfidence(
        "Verified kilos must agree with kilos shipped within ±2.0%. A member's season kilos may not exceed 1.6 kg per registered tree. Any reading below 0.85 confidence shall be confirmed by a person.",
      ),
    ).toBeNull(); // was 200, the tolerance
  });

  it("still reads ordinary prose around a value", () => {
    expect(parsePeso("until the member's paid-up CBU reaches ₱5,000.")).toBe(500_000);
    expect(parsePeso("₱5,000, then nothing")).toBe(500_000);
    expect(parsePercent("CBU - 5% of the bonus")).toBe(500);
    expect(parsePercent("build-up: 5%")).toBe(500);
    expect(parsePercent("+/-2%")).toBe(200);
    expect(parseKgPerTree("1.60 kg per registered tree")).toBe(16);
    expect(parseConfidence("0.85.")).toBe(8500);
    expect(parseConfidence("85%")).toBe(8500);
    expect(parseConfidence("R6: below .85")).toBe(8500); // a rule id's digit is not a number
    expect(parsePeso("Hauling – ₱1.50 per kilo")).toBe(150);
    expect(parseUsd("any payout batch over US$300, any member line")).toBe(30_000);
  });

  it("round trip: an amount written any usual way parses back to exactly that amount", () => {
    const r = rng(0x5eed_0001);
    const lead = ["", "Hauling: ", "until it reaches ", "a cap of ", "(", "R2 "];
    const tail = ["", " per kilo", " per kilo of net weight.", ".", ", then", ")", " (31 Aug)"];
    for (let n = 0; n < 3000; n++) {
      const minor = pick(r, [int(r, 0, 999), int(r, 0, 99_999), int(r, 0, 999_999_999)]);
      const peso = `${pick(r, lead)}${pick(r, ["₱", "₱ ", "P", "P ", "PHP", "PHP "])}${writeHundredths(r, minor, { group: true })}${pick(r, tail)}`;
      expect(parsePeso(peso), peso).toBe(minor);
      const usd = `${pick(r, lead)}${pick(r, ["US$", "US$ ", "USD", "USD ", "$"])}${writeHundredths(r, minor, { group: true })}${pick(r, tail)}`;
      expect(parseUsd(usd), usd).toBe(minor);
      const bp = int(r, 0, 100_000);
      const pct = `${pick(r, ["", "±", "+/-", "within ±", "CBU: "])}${writeHundredths(r, bp, { group: false })}${pick(r, ["%", " %", " percent", " porsiyento"])}${pick(r, tail)}`;
      expect(parsePercent(pct), pct).toBe(bp);
      const tenths = int(r, 0, 999);
      const kg = `${writeHundredths(r, tenths * 10, { group: false })}${pick(r, [" kg", "kg", " kilos", " kilo", " kilograms"])}${pick(r, [" per registered tree", "/tree", ""])}`;
      expect(parseKgPerTree(kg), kg).toBe(tenths);
      const conf = int(r, 0, 10_000);
      const written =
        conf === 10_000
          ? pick(r, ["1", "1.0", "1.00", "1.0000"])
          : `${pick(r, ["0", ""])}.${String(conf)
              .padStart(4, "0")
              .replace(/(\d)0+$/, "$1")}`;
      expect(parseConfidence(`below ${written} confidence`), written).toBe(conf);
    }
  });

  it("an extra digit, a third decimal or a minus sign makes any written amount a parse failure", () => {
    const r = rng(0x5eed_0002);
    for (let n = 0; n < 2000; n++) {
      const whole = int(r, 1, 999_999);
      const grouped = whole.toLocaleString("en-US");
      const two = `${whole}.${digits(r, 2)}`;
      // A third decimal, or a digit past a thousands group, is never trimmed into a shorter number.
      expect(parsePeso(`₱${two}${digits(r, 1)}`)).toBeNull();
      expect(parseUsd(`US$${two}${digits(r, 1)} batch`)).toBeNull();
      expect(parsePercent(`${two}${digits(r, 1)}%`)).toBeNull();
      if (grouped.includes(",")) expect(parsePeso(`P${grouped}${digits(r, 1)}`)).toBeNull();
      // "12.505%": a longer number's tail is never a percentage of its own.
      expect(parsePercent(`${whole}.${digits(r, 3)}%`)).toBeNull();
      expect(parseKgPerTree(`${whole}.${int(r, 1, 9)}${int(r, 1, 9)} kg`)).toBeNull();
      // A minus sign, attached or at the start, before the marker or the number.
      const sign = pick(r, ["-", "−", "–", "- ", "(-"]);
      expect(parsePeso(`${sign}₱${grouped}`)).toBeNull();
      expect(parsePeso(`${sign}${pick(r, ["P", "PHP "])}${two}`)).toBeNull();
      expect(parseUsd(`${sign}US$${two}`)).toBeNull();
      expect(parsePercent(`${sign}${whole % 100}%`)).toBeNull();
      expect(parseKgPerTree(`${sign}${whole % 10}.${int(r, 0, 9)} kg`)).toBeNull();
      expect(parseConfidence(`${sign}0.${digits(r, 2)}`)).toBeNull();
    }
  });

  it("fuzz: whatever comes back is the strict value of one whole number in the text, unsigned", () => {
    const r = rng(0x5eed_0003);
    const tokens: Array<(r: Rand) => string> = [
      (r) => digits(r, int(r, 1, 4)),
      (r) => `${digits(r, int(r, 1, 3))}.${digits(r, int(r, 1, 4))}`,
      (r) => `${digits(r, int(r, 1, 3))},${digits(r, int(r, 1, 4))}`,
      (r) => `${digits(r, int(r, 1, 3))},${digits(r, 3)},${digits(r, 3)}`,
      (r) => `0.${digits(r, int(r, 1, 5))}`,
      (r) => `.${digits(r, int(r, 1, 3))}`,
      ...["₱", "P", "PHP ", "US$", "$", "USD ", "%", " %", " percent", " kg", "kg", " kilos"].map(
        (t) => () => t,
      ),
      ...[
        "-",
        "−",
        "–",
        "±",
        "+/-",
        " ",
        " ",
        ".",
        ",",
        "(",
        ")",
        " per kilo",
        " of bonus",
        "R2 ",
        "1.0",
      ].map((t) => () => t),
    ];
    let typed = 0;
    for (let n = 0; n < 40_000; n++) {
      const s = Array.from({ length: int(r, 1, 7) }, () => pick(r, tokens)(r)).join("");
      const checks: Array<[string, number | null, Read, RegExp, boolean]> = [
        ["peso", parsePeso(s), strict.peso, MONEY_MARK, false],
        ["usd", parseUsd(s), strict.usd, MONEY_MARK, false],
        ["percent", parsePercent(s), strict.percent, SIGN_MARK, false],
        ["kg", parseKgPerTree(s), strict.kg, NO_MARK, false],
        ["confidence", parseConfidence(s), strict.confidence, SIGN_MARK, true],
      ];
      for (const [name, value, read, marker, leadingDot] of checks) {
        if (value === null) continue;
        typed++;
        expect(
          explained(s, value, read, marker, leadingDot),
          `${name} ${JSON.stringify(s)} -> ${value}`,
        ).toBe(true);
      }
    }
    // The generator reaches the parsers' typed paths often enough to mean something.
    expect(typed).toBeGreaterThan(5000);
  });
});
