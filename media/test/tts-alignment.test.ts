import { describe, expect, it } from "vitest";
import { adaptiveCuts, alignWords, STATEMENT_CER_LIMIT } from "../src/tts/alignment.js";

function wave(parts: readonly [seconds: number, amplitude: number][]): Buffer {
  const rate = 8_000;
  const samples = parts.flatMap(([seconds, amplitude]) =>
    Array.from({ length: Math.round(seconds * rate) }, (_, i) =>
      Math.round(Math.sin((2 * Math.PI * 300 * i) / rate) * amplitude * 32_767),
    ),
  );
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => {
    out.writeInt16LE(sample, 44 + i * 2);
  });
  return out;
}

describe("adaptiveCuts", () => {
  it("uses expected unequal durations to preserve a natural internal pause", () => {
    const wav = wave([
      [0.2, 0],
      [0.8, 0.3],
      [0.18, 0],
      [1.2, 0.3],
      [0.2, 0],
      [0.5, 0.3],
      [0.2, 0],
    ]);
    const split = adaptiveCuts(wav, ["one two three four", "five"]);
    expect(split?.cuts).toHaveLength(2);
    expect(split?.cuts[0]?.end).toBeCloseTo(2.53, 2);
    expect(split?.onsets).toEqual([0.2, 2.58]);
  });

  it("detects shorter sentence gaps against the take's own noisy floor", () => {
    const split = adaptiveCuts(
      wave([
        [0.2, 0.012],
        [0.6, 0.12],
        [0.14, 0.012],
        [0.6, 0.12],
        [0.2, 0.012],
      ]),
      ["one", "two"],
    );
    expect(split?.cuts).toHaveLength(2);
    expect(split?.onsets).toEqual([0.2, 0.94]);
    expect(split?.cuts.every((cut) => cut.end > cut.start)).toBe(true);
  });

  it("rejects too few gaps and implausibly imbalanced sentence cuts", () => {
    expect(adaptiveCuts(wave([[2, 0.3]]), ["one", "two"])).toBeNull();
    expect(
      adaptiveCuts(
        wave([
          [0.2, 0.3],
          [0.2, 0],
          [3, 0.3],
        ]),
        ["one", "two"],
      ),
    ).toBeNull();
    expect(
      adaptiveCuts(
        wave([
          [1, 0.3],
          [0.2, 0],
          [1, 0.3],
        ]),
        ["one", "two", "three"],
      ),
    ).toBeNull();
    expect(adaptiveCuts(Buffer.from("invalid"), ["one"])).toBeNull();
    expect(adaptiveCuts(wave([[1, 0]]), ["one"])).toBeNull();
  });
});

describe("alignWords", () => {
  const words = (texts: readonly string[]) =>
    texts.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.2 }));

  it("normalises punctuation and numerals while preserving measured anchor starts", () => {
    const expected = "Pay twenty pesos, Maria.";
    expect(STATEMENT_CER_LIMIT).toBe(0.12);
    expect(
      alignWords(words(["Pay", "20", "pesos", "Maria"]), expected, 2, [
        { ref: "fact:PAY", spoken: "twenty pesos", start: 4 },
        { ref: "member:M", spoken: "Maria", start: expected.indexOf("Maria") },
      ]),
    ).toEqual({
      cer: 0,
      offsets: [
        { ref: "fact:PAY", at_ms: 300 },
        { ref: "member:M", at_ms: 900 },
      ],
    });
  });

  it("allows surrounding recognition edits without guessing anchor timing", () => {
    const expected = "Your final total is twenty pesos today";
    const result = alignWords(
      words(["The", "final", "total", "is", "twenty", "pesos", "today"]),
      expected,
      3,
      [{ ref: "fact:PAY", spoken: "twenty pesos", start: expected.indexOf("twenty") }],
    );
    expect(result?.offsets).toEqual([{ ref: "fact:PAY", at_ms: 1_200 }]);
    expect(result?.cer).toBeLessThanOrEqual(STATEMENT_CER_LIMIT);
  });

  it("uses a uniquely aligned name onset when whole-anchor CER is within the unchanged limit", () => {
    const expected = "Good day Nang Celing and thank you for your work today";
    const heard = words("Good day Nang Seling and thank you for your work today".split(" "));
    const result = alignWords(heard, expected, 5, [
      { ref: "fact:HONORIFIC_NAME", spoken: "Nang Celing", start: expected.indexOf("Nang") },
    ]);
    expect(result?.offsets).toEqual([{ ref: "fact:HONORIFIC_NAME", at_ms: 600 }]);
    expect(result?.cer).toBeLessThanOrEqual(0.12);
    expect(STATEMENT_CER_LIMIT).toBe(0.12);
  });

  it("aligns numeric ASR formatting for explicit slip and rule identifiers", () => {
    const expected = "See slip zero four zero three under R one.";
    expect(
      alignWords(words(["See", "slip", "0403", "under", "R1"]), expected, 3, [
        { ref: "slip:0403", spoken: "zero four zero three", start: expected.indexOf("zero") },
        { ref: "rule:R1", spoken: "R one", start: expected.indexOf("R one") },
      ]),
    ).toEqual({
      cer: 0,
      offsets: [
        { ref: "slip:0403", at_ms: 600 },
        { ref: "rule:R1", at_ms: 1200 },
      ],
    });
  });

  it("rejects wrong or missing anchors despite low global CER", () => {
    const expected = "Your final total is twenty pesos today and thank you for all your valuable work";
    for (const heard of [
      "Your final total is ninety pesos today and thank you for all your valuable work",
      "Your final total is twenty today and thank you for all your valuable work",
    ])
      expect(
        alignWords(words(heard.split(" ")), expected, 8, [
          { ref: "fact:PAY", spoken: "twenty pesos", start: expected.indexOf("twenty") },
        ]),
      ).toBeNull();
    const name = "Good day Nang Celing and thank you for all your valuable work today";
    expect(
      alignWords(words(name.replace("Celing", "Maria").split(" ")), name, 8, [
        { ref: "fact:HONORIFIC_NAME", spoken: "Nang Celing", start: name.indexOf("Nang") },
      ]),
    ).toBeNull();
  });

  it("inv.i1.pay-amount: accepts compound spelling but rejects a changed amount inside the same anchor", () => {
    const amount = "mga four thousand twenty-eight pesos, gibanabana";
    const expected = `Sa peso ${amount} sa dili pa ang bayad.`;
    const anchors = [{ ref: "fact:NET_PHP", spoken: amount, start: expected.indexOf("mga") }];
    const heard = expected.replace("gibanabana", "gibana-bana");
    expect(alignWords(words(heard.split(" ")), expected, 10, anchors)?.offsets).toEqual([
      { ref: "fact:NET_PHP", at_ms: 600 },
    ]);
    for (const wrong of ["twenty-nine", "thirty-eight", "twenty-seven"])
      expect(
        alignWords(words(heard.replace("twenty-eight", wrong).split(" ")), expected, 10, anchors),
      ).toBeNull();
    const usd = "sixty-four dollars and forty-five cents";
    for (const wrong of ["sixty-five dollars and forty-five cents", "sixty-four dollars and forty-six cents"])
      expect(
        alignWords(words(wrong.split(" ")), usd, 10, [{ ref: "fact:NET_USD", spoken: usd, start: 0 }]),
      ).toBeNull();
    expect(
      alignWords(words(["$64.45"]), usd, 10, [{ ref: "fact:NET_USD", spoken: usd, start: 0 }])?.cer,
    ).toBe(0);
    expect(STATEMENT_CER_LIMIT).toBe(0.12);
  });

  it("inv.i1.cbu-amount: aligns spoken initials but refuses a changed deduction or initial", () => {
    const expected = "Less forty-five cents for CBU, your capital build-up under R one.";
    const anchors = [
      { ref: "fact:DEDUCTION_USD", spoken: "forty-five cents", start: expected.indexOf("forty") },
      { ref: "fact:RULE_LABEL", spoken: "CBU, your capital build-up", start: expected.indexOf("CBU") },
      { ref: "rule:R1", spoken: "R one", start: expected.indexOf("R one") },
    ];
    const heard = expected.replace("CBU", "C B U");
    expect(alignWords(words(heard.split(" ")), expected, 10, anchors)?.offsets).toEqual([
      { ref: "fact:DEDUCTION_USD", at_ms: 300 },
      { ref: "fact:RULE_LABEL", at_ms: 1200 },
      { ref: "rule:R1", at_ms: 3300 },
    ]);
    for (const wrong of [
      heard.replace("forty-five", "forty-six"),
      heard.replace("R one", "R two"),
      ...["C B X", "C B V", "CBX", "CBV"].map((initials) => heard.replace("C B U", initials)),
    ])
      expect(alignWords(words(wrong.split(" ")), expected, 10, anchors)).toBeNull();
  });

  it("inv.i1.treasurer-spelling: accepts a doubled n without accepting a different treasurer or amount", () => {
    const expected = "Treasurer Analyn approved forty-five cents today.";
    const anchors = [
      { ref: "fact:TREASURER", spoken: "Analyn", start: expected.indexOf("Analyn") },
      { ref: "fact:NET_USD", spoken: "forty-five cents", start: expected.indexOf("forty") },
    ];
    const heard = expected.replace("Analyn", "Annalyn");
    expect(alignWords(words(heard.split(" ")), expected, 5, anchors)?.offsets).toEqual([
      { ref: "fact:TREASURER", at_ms: 300 },
      { ref: "fact:NET_USD", at_ms: 900 },
    ]);
    for (const wrong of [
      heard.replace("forty-five", "forty-six"),
      expected.replace("Analyn", "Annalin"),
      expected.replace("Analyn", "Ann Lynn"),
      expected.replace("Analyn", "Annabelle"),
    ])
      expect(alignWords(words(wrong.split(" ")), expected, 5, anchors)).toBeNull();
  });

  it("uses reference position for repeated words, rejecting ambiguous recognition deletions", () => {
    expect(
      alignWords(words(["pay", "pay", "now"]), "pay pay now", 2, [{ ref: "second", spoken: "pay", start: 4 }])
        ?.offsets,
    ).toEqual([{ ref: "second", at_ms: 300 }]);
    expect(
      alignWords(words(["pay", "now"]), "pay pay now", 2, [{ ref: "second", spoken: "pay", start: 4 }]),
    ).toBeNull();
    const prefix = "Please review your final statement and then ";
    const expected = `${prefix}pay pay now`;
    expect(
      alignWords(words(`${prefix}pay now`.split(" ")), expected, 10, [
        { ref: "second", spoken: "pay", start: prefix.length + 4 },
      ]),
    ).toBeNull();
  });

  it("rejects an offset that rounds outside the clip", () => {
    expect(
      alignWords([{ text: "pay", start: 0.9997, end: 0.9999 }], "pay", 1, [
        { ref: "pay", spoken: "pay", start: 0 },
      ]),
    ).toBeNull();
  });

  it("rejects wrong text, missing or invalid anchors, and invalid timestamps", () => {
    expect(alignWords(words(["wrong", "sentence"]), "pay now", 2, [])).toBeNull();
    const expected = "Your final total is twenty pesos today";
    expect(
      alignWords(words(["Your", "final", "total", "is", "ninety", "peso", "today"]), expected, 3, [
        { ref: "pay", spoken: "twenty pesos", start: expected.indexOf("twenty") },
      ]),
    ).toBeNull();
    expect(
      alignWords(words(["pay", "now"]), "pay now", 1, [{ ref: "x", spoken: "pay", start: 1 }]),
    ).toBeNull();
    for (const invalid of [
      [{ text: "pay", start: -1, end: 0.2 }],
      [{ text: "pay", start: 0.3, end: 0.2 }],
      [{ text: "pay", start: 0, end: Number.NaN }],
      [{ text: "pay", start: 0, end: 2 }],
      [
        { text: "pay", start: 0, end: 0.5 },
        { text: "now", start: 0.4, end: 0.7 },
      ],
    ])
      expect(alignWords(invalid, "pay now", 1, [])).toBeNull();
  });
});
