import { describe, expect, it } from "vitest";
import { jsonbBytes } from "../src/jsonb-size.js";

describe("outbox arguments use PostgreSQL jsonb text bytes", () => {
  it.each([
    [{}, "{}"],
    [{ runId: "r" }, '{"runId": "r"}'],
    [
      { a: [null, true, { b: 'é🙂, : \\"' }], c: [] },
      '{"a": [null, true, {"b": "é🙂, : \\\\\\""}], "c": []}',
    ],
    [{ n: 1e21 }, '{"n": 1000000000000000000000}'],
    [{ n: -1.234e-7 }, '{"n": -0.0000001234}'],
    [{ n: 1.2345678901234568e21 }, '{"n": 1234567890123456800000}'],
  ])("counts %j with spaces, UTF-8 and expanded exponents", (value, text) => {
    expect(jsonbBytes(value)).toBe(Buffer.byteLength(text));
  });
});
