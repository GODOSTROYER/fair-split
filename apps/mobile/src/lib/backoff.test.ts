import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  nextAttemptAt,
  parseRetryAfter,
  RETRY_AFTER_MAX_MS,
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  retryDelayMs,
} from "./backoff";

const NOW = Date.parse("2026-10-27T01:00:00Z");

describe("retryDelayMs", () => {
  it("doubles from 10 s and caps at 5 minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50].map(retryDelayMs)).toEqual([
      0, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
  });

  it("matches the copy: the third attempt waits 40 s (M-CL-01 failed)", () => {
    expect(retryDelayMs(3) / 1000).toBe(40);
  });

  it("is due now for nonsense attempt counts", () => {
    for (const n of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) expect(retryDelayMs(n)).toBe(0);
  });

  it("never decreases and never leaves [base, cap] after the first failure", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (n) => {
        const d = retryDelayMs(n);
        expect(d).toBeGreaterThanOrEqual(RETRY_BASE_MS);
        expect(d).toBeLessThanOrEqual(RETRY_CAP_MS);
        expect(retryDelayMs(n + 1)).toBeGreaterThanOrEqual(d);
      }),
    );
  });
});

describe("parseRetryAfter", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120_000);
    expect(parseRetryAfter(" 0 ", NOW)).toBe(0);
  });

  it("reads an HTTP-date relative to now, never negative", () => {
    expect(parseRetryAfter("Tue, 27 Oct 2026 01:01:30 GMT", NOW)).toBe(90_000);
    expect(parseRetryAfter("Tue, 27 Oct 2026 00:59:00 GMT", NOW)).toBe(0);
  });

  it("caps a server's wait at an hour", () => {
    expect(parseRetryAfter("86400", NOW)).toBe(RETRY_AFTER_MAX_MS);
  });

  it("ignores what it cannot read", () => {
    for (const v of [null, undefined, "", "soon", "-5", "1.5"]) expect(parseRetryAfter(v, NOW)).toBeNull();
  });
});

describe("nextAttemptAt", () => {
  it("takes the backoff unless the server asks for longer", () => {
    expect(nextAttemptAt(NOW, 1)).toBe(NOW + 10_000);
    expect(nextAttemptAt(NOW, 1, 3_000)).toBe(NOW + 10_000);
    expect(nextAttemptAt(NOW, 1, 60_000)).toBe(NOW + 60_000);
    expect(nextAttemptAt(NOW, 6, null)).toBe(NOW + RETRY_CAP_MS);
  });
});
