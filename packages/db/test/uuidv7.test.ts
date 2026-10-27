import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createUuidv7Generator, isUuidv7, uuidv7, uuidv7Timestamp } from "../src/ids/uuidv7.js";

describe("uuidv7", () => {
  it("has the RFC 9562 version and variant bits", () => {
    for (let i = 0; i < 1000; i++) {
      const id = uuidv7();
      expect(isUuidv7(id)).toBe(true);
      expect(id[14]).toBe("7");
      expect("89ab").toContain(id[19]);
    }
  });

  it("embeds the millisecond timestamp", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it("is strictly increasing within a process, including many ids in one millisecond", () => {
    const gen = createUuidv7Generator(() => 1_792_653_210_580);
    const ids = Array.from({ length: 10_000 }, () => gen());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) expect((ids[i - 1] as string) < (ids[i] as string)).toBe(true);
  });

  it("stays monotonic when the clock steps backwards", () => {
    let now = 1_792_653_210_580;
    const gen = createUuidv7Generator(() => now);
    const a = gen();
    now -= 5_000;
    const b = gen();
    expect(a < b).toBe(true);
    expect(uuidv7Timestamp(b)).toBeGreaterThanOrEqual(uuidv7Timestamp(a));
  });

  it("property: any non-decreasing clock sequence yields strictly increasing ids", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 300 }), (steps) => {
        let now = 1_700_000_000_000;
        const gen = createUuidv7Generator(() => now);
        let prev = "";
        for (const s of steps) {
          now += s;
          const id = gen();
          if (!(prev < id) || !isUuidv7(id)) return false;
          prev = id;
        }
        return true;
      }),
    );
  });

  it("rejects timestamps outside 48 bits", () => {
    const gen = createUuidv7Generator();
    expect(() => gen.at(-1)).toThrow(RangeError);
    expect(() => gen.at(2 ** 48)).toThrow(RangeError);
  });
});
