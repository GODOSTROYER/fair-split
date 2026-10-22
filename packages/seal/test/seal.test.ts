import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BANDS,
  bandCircle,
  digestBytes,
  hashGroups,
  isSigned,
  MAX_POINTS,
  ringParameters,
  seal,
  sealSvg,
} from "../src/seal.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const A = sha("fs:2026A:r37:batch");
const B = sha("fs:2026A:r38:batch");

/** Flips one bit of a hex digest. */
function flipBit(hex: string, bit: number): string {
  const bytes = digestBytes(hex);
  const i = Math.floor(bit / 8);
  bytes[i] = (bytes[i] ?? 0) ^ (1 << (bit % 8));
  return Buffer.from(bytes).toString("hex");
}

function points(d: string): [number, number][] {
  const nums = d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
  return out;
}

describe("seal determinism", () => {
  it("the same digest grows an identical seal, every time", () => {
    expect(seal(A, 200)).toEqual(seal(A, 200));
    expect(sealSvg(A, 200)).toBe(sealSvg(A, 200));
  });

  it("is case- and whitespace-insensitive about the digest", () => {
    expect(seal(` ${A.toUpperCase()} `, 200).rings).toEqual(seal(A, 200).rings);
  });

  it("different digests grow different seals", () => {
    const a = seal(A, 200).rings.map((r) => r.d);
    const b = seal(B, 200).rings.map((r) => r.d);
    expect(a).not.toEqual(b);
  });

  it("a one-bit change in any parameter byte changes the seal", () => {
    const base = sealSvg(A, 200);
    for (let byteIndex = 0; byteIndex < 20; byteIndex++) {
      const changed = sealSvg(flipBit(A, byteIndex * 8 + 7), 200);
      expect(changed, `byte ${byteIndex}`).not.toBe(base);
    }
  });

  it("over 200 random batches, no two seals collide", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 200; n++)
      seen.add(
        seal(sha(`batch-${n}`), 200)
          .rings.map((r) => r.d)
          .join("|"),
      );
    expect(seen.size).toBe(200);
  });

  it("freezes the algorithm: known parameters for a known digest (S2 §2.7)", () => {
    const zero = "0".repeat(64);
    const params = ([0, 1, 2, 3, 4] as const).map((i) => ringParameters(digestBytes(zero), i));
    // b = 0 everywhere: N = 12, M = 2 → gcd 2 → steps to 5 (3 shares 3, 4 shares 4), p = (N−M)·0.35.
    for (const p of params) {
      expect(p.lobes).toBe(12);
      expect(p.turns).toBe(5);
      expect(p.pen).toBeCloseTo(7 * 0.35, 10);
      expect(p.rotation).toBe(0);
    }
    const ff = "f".repeat(64);
    const top = ringParameters(digestBytes(ff), 0);
    // 255 % 37 = 33 → N = 45; 255 % 7 = 3 → M = 5 → gcd(45,5) = 5 → 6 → gcd 3 → 7: coprime.
    expect(top).toMatchObject({ lobes: 45, turns: 7 });
    expect(top.pen).toBeCloseTo(38 * 0.85, 10);
    // Any change to the drawing algorithm changes every seal in the world: this hash pins it.
    expect(createHash("sha256").update(sealSvg(A, 200)).digest("hex")).toBe(
      "c063484b80d061bc9625bcfa53e62ce02301aff560186e7bae5c35cfb4ecc9dc",
    );
    expect(ringParameters(digestBytes(A), 3)).toMatchObject({ lobes: 43, turns: 3 });
  });
});

describe("seal geometry", () => {
  const geometry = seal(A, 200);

  it("has five rings: the inner three for key 1, the outer two for key 2", () => {
    expect(geometry.rings.map((r) => r.owner)).toEqual([1, 1, 1, 2, 2]);
    expect(geometry.rings.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps every ring's parameters inside S2's ranges with coprime lobes and turns", () => {
    for (let n = 0; n < 100; n++) {
      const bytes = digestBytes(sha(`params-${n}`));
      for (const i of [0, 1, 2, 3, 4] as const) {
        const { lobes, turns, pen } = ringParameters(bytes, i);
        expect(lobes).toBeGreaterThanOrEqual(12);
        expect(lobes).toBeLessThanOrEqual(48);
        expect(turns).toBeGreaterThanOrEqual(2);
        expect(turns).toBeLessThanOrEqual(8);
        let [x, y] = [lobes, turns];
        while (y) [x, y] = [y, x % y];
        expect(x).toBe(1);
        expect(pen).toBeGreaterThanOrEqual((lobes - turns) * 0.35 - 1e-9);
        expect(pen).toBeLessThanOrEqual((lobes - turns) * 0.85 + 1e-9);
      }
    }
  });

  it("draws each ring inside its band, with at most 2,000 points (design §9 budget)", () => {
    for (const r of geometry.rings) {
      expect(r.points).toBeLessThanOrEqual(Math.min(MAX_POINTS, 24 * r.lobes));
      const [lo, hi] = BANDS[r.index] ?? [0, 0];
      for (const [x, y] of points(r.d)) {
        const radius = Math.hypot(x - 100, y - 100);
        expect(radius).toBeGreaterThanOrEqual(lo - 0.02);
        expect(radius).toBeLessThanOrEqual(hi + 0.02);
      }
    }
  });

  it("reports a polyline length for native dash animation", () => {
    for (const r of geometry.rings) {
      const pts = points(r.d);
      let length = 0;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1] ?? [0, 0];
        const [x1, y1] = pts[i] ?? [0, 0];
        length += Math.hypot(x1 - x0, y1 - y0);
      }
      const [fx, fy] = pts[0] ?? [0, 0];
      const [lx, ly] = pts.at(-1) ?? [0, 0];
      length += Math.hypot(fx - lx, fy - ly);
      expect(r.length).toBeCloseTo(length, 0);
    }
  });

  it("scales with size, and strokes 0.75 px at 200 px (never under 0.5)", () => {
    expect(geometry.strokeWidth).toBe(0.75);
    expect(seal(A, 64).strokeWidth).toBe(0.5);
    expect(seal(A, 320).strokeWidth).toBeCloseTo(1.2, 10);
    const big = seal(A, 400);
    for (const [i, r] of big.rings.entries()) {
      expect(r.band[0]).toBeCloseTo((geometry.rings[i]?.band[0] ?? 0) * 2, 10);
      expect(r.length).toBeCloseTo((geometry.rings[i]?.length ?? 0) * 2, -1);
    }
  });

  it("refuses anything that is not a sha256 digest, or a size that is not positive", () => {
    expect(() => seal("7f3a91c2", 200)).toThrow(/64 hexadecimal/);
    expect(() => seal("z".repeat(64), 200)).toThrow(/64 hexadecimal/);
    expect(() => seal(A, 0)).toThrow(/positive size/);
  });
});

describe("signing states", () => {
  it("key 1 engraves the inner rings; key 2 completes the seal", () => {
    expect(([0, 1, 2, 3, 4] as const).map((i) => isSigned(i, 0))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(([0, 1, 2, 3, 4] as const).map((i) => isSigned(i, 1))).toEqual([true, true, true, false, false]);
    expect(([0, 1, 2, 3, 4] as const).map((i) => isSigned(i, 2))).toEqual([true, true, true, true, true]);
  });

  it("draws unsigned bands as 1 px rule circles", () => {
    const none = sealSvg(A, 200, { keys: 0 });
    expect(none.match(/<circle /g)).toHaveLength(5);
    expect(none.match(/<path /g)).toBeNull();
    const one = sealSvg(A, 200, { keys: 1 });
    expect(one.match(/<path /g)).toHaveLength(3);
    expect(one.match(/<circle /g)).toHaveLength(2);
    expect(bandCircle(4, 200)).toEqual({ cx: 100, cy: 100, r: 93 });
  });

  it("produces a standalone, titled SVG for the sharp PNG path", () => {
    const svg = sealSvg(A, 512, { background: "#FFFFFF" });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="512"')).toBe(true);
    expect(svg).toContain(`<title>Batch seal ${hashGroups(A)}</title>`);
    expect(svg.length).toBeLessThan(200_000);
  });

  it("writes hashes in groups of four", () => {
    expect(hashGroups("7F3A91C2DEADBEEF")).toBe("7f3a 91c2");
    expect(hashGroups("7f3a91c2deadbeef", 4)).toBe("7f3a 91c2 dead beef");
  });
});
