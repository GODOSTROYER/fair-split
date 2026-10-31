import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BANDS,
  bandCircle,
  digestBytes,
  hashGroups,
  isRingSigned,
  isSigned,
  MAX_POINTS,
  RANGES,
  ringBandCircle,
  ringParameters,
  SAMPLES_PER_LOBE,
  SEAL_PRINT,
  SMALL_RINGS,
  seal,
  sealHash,
  sealPrintSvg,
  sealStroke,
  sealSvg,
  sealVariant,
  TWO_RING_BELOW,
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

const coprime = (a: number, b: number) => {
  let [x, y] = [a, b];
  while (y) [x, y] = [y, x % y];
  return x === 1;
};

describe("seal determinism", () => {
  it("the same digest grows an identical seal, every time, at every size", () => {
    for (const size of [64, 96, 200, 320]) {
      expect(seal(A, size)).toEqual(seal(A, size));
      expect(sealSvg(A, size)).toBe(sealSvg(A, size));
    }
  });

  it("is case- and whitespace-insensitive about the digest", () => {
    expect(seal(` ${A.toUpperCase()} `, 200).rings).toEqual(seal(A, 200).rings);
  });

  it("different digests grow different seals", () => {
    const a = seal(A, 200).rings.map((r) => r.d);
    const b = seal(B, 200).rings.map((r) => r.d);
    expect(a).not.toEqual(b);
    expect(seal(A, 64).rings.map((r) => r.d)).not.toEqual(seal(B, 64).rings.map((r) => r.d));
  });

  it("every lobe, rotation and pen byte moves the five-ring seal; a turn byte does whenever N allows a choice", () => {
    for (const digest of [A, B, sha("fs:2026A:r39:batch")]) {
      const base = sealSvg(digest, 200);
      const bytes = digestBytes(digest);
      for (let byteIndex = 0; byteIndex < 20; byteIndex++) {
        const changed = [1, 2].map((step) => {
          const next = Uint8Array.from(bytes);
          next[byteIndex] = ((next[byteIndex] ?? 0) + step) % 256;
          return sealSvg(Buffer.from(next).toString("hex"), 200);
        });
        const moved = changed.some((svg) => svg !== base);
        if (byteIndex >= 5 && byteIndex < 10) {
          // M = 2 + b % 4 stepped to the next coprime: for N = 12, 18 or 20 only one M in 2–5 is coprime.
          const lobes = ringParameters(bytes, (byteIndex - 5) as 0 | 1 | 2 | 3 | 4).lobes;
          const choices = [2, 3, 4, 5].filter((m) => coprime(lobes, m)).length;
          expect(moved, `byte ${byteIndex} (N = ${lobes})`).toBe(choices > 1);
        } else {
          expect(moved, `byte ${byteIndex}`).toBe(true);
          expect(sealSvg(flipBit(digest, byteIndex * 8), 200), `bit 0 of byte ${byteIndex}`).not.toBe(base);
        }
      }
    }
  });

  // 600 seals take under 1 s alone; under turbo on a 2-core CI runner they took over 5 s.
  it("over 300 random batches, no two seals collide at 200 px or at 64 px", { timeout: 30_000 }, () => {
    for (const size of [200, 64]) {
      const seen = new Set<string>();
      for (let n = 0; n < 300; n++)
        seen.add(
          seal(sha(`batch-${n}`), size)
            .rings.map((r) => r.d)
            .join("|"),
        );
      expect(seen.size, `${size} px`).toBe(300);
    }
  });

  it("freezes the algorithm: known parameters for known digests (S2 §2.7)", () => {
    const zero = digestBytes("0".repeat(64));
    // b = 0 everywhere: N = 10, M = 2 shares 2 with 10, so M steps to 3; p = (10 − 3)·0.45.
    for (const i of [0, 1, 2, 3, 4] as const) {
      expect(ringParameters(zero, i)).toEqual({ lobes: 10, turns: 3, pen: 7 * 0.45, rotation: 0 });
    }
    const ff = digestBytes("f".repeat(64));
    // 255 % 11 = 2 → N = 12; 255 % 4 = 3 → M = 5, coprime with 12; p = 7·0.65.
    expect(ringParameters(ff, 0)).toMatchObject({ lobes: 12, turns: 5 });
    expect(ringParameters(ff, 0).pen).toBeCloseTo(7 * 0.65, 10);
    expect(ringParameters(ff, 0).rotation).toBeCloseTo((2 * Math.PI * 255) / 256 / 12, 12);
    // Two-ring variant: 255 % 7 = 3 → N = 9; 255 % 2 = 1 → M = 3 shares 3 with 9 → wraps to 2.
    expect(ringParameters(ff, 0, "two")).toMatchObject({ lobes: 9, turns: 2 });
    // N = 6 has no coprime M in 2–3, so it steps to 7.
    expect(ringParameters(zero, 0, "two")).toMatchObject({ lobes: 7, turns: 2 });
    expect(ringParameters(digestBytes(A), 3)).toMatchObject({ lobes: 10, turns: 3 });
    // Any change to the drawing algorithm changes every seal in the world: these hashes pin it.
    expect(createHash("sha256").update(sealSvg(A, 200)).digest("hex")).toBe(
      "57d0988d3846724b8300ad5874b6880c8604424b221b5ddae5660e5314d339e2",
    );
    expect(createHash("sha256").update(sealSvg(A, 64)).digest("hex")).toBe(
      "a6412af333e1fc925833269ffd2fee038afe079307c29118745be9c9ff124d8f",
    );
  });
});

describe("seal geometry", () => {
  const geometry = seal(A, 200);

  it("has five rings at 96 px and up: the inner three for key 1, the outer two for key 2", () => {
    expect(geometry.variant).toBe("five");
    expect(geometry.rings.map((r) => r.owner)).toEqual([1, 1, 1, 2, 2]);
    expect(geometry.rings.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(seal(A, TWO_RING_BELOW).variant).toBe("five");
  });

  it("draws two rings below 96 px, one per key, grown from rings 0 and 3's bytes", () => {
    const small = seal(A, 64);
    expect(small.variant).toBe("two");
    expect(sealVariant(95.9)).toBe("two");
    expect(small.rings.map((r) => r.owner)).toEqual([1, 2]);
    expect(small.rings.map((r) => r.source)).toEqual([0, 3]);
    expect(geometry.rings.map((r) => r.source)).toEqual([0, 1, 2, 3, 4]);
    const bytes = digestBytes(A);
    for (const [i, spec] of SMALL_RINGS.entries()) {
      const r = small.rings[i];
      expect(r?.lobes).toBe(ringParameters(bytes, spec.bytes, "two").lobes);
      expect(r?.band).toEqual([
        Math.round(spec.band[0] * 0.32 * 100) / 100,
        Math.round(spec.band[1] * 0.32 * 100) / 100,
      ]);
    }
  });

  it("keeps every ring's parameters inside S2's ranges with coprime lobes and turns", () => {
    for (let n = 0; n < 300; n++) {
      const bytes = digestBytes(sha(`params-${n}`));
      for (const variant of ["five", "two"] as const) {
        for (const i of [0, 1, 2, 3, 4] as const) {
          const { lobes, turns, pen } = ringParameters(bytes, i, variant);
          const range = RANGES[variant];
          expect(lobes).toBeGreaterThanOrEqual(range.lobes[0]);
          expect(lobes).toBeLessThanOrEqual(range.lobes[1]);
          expect(turns).toBeGreaterThanOrEqual(range.turns[0]);
          expect(turns).toBeLessThanOrEqual(range.turns[1]);
          expect(coprime(lobes, turns), `${variant} ${lobes}/${turns}`).toBe(true);
          expect(pen).toBeGreaterThanOrEqual((lobes - turns) * 0.45 - 1e-9);
          expect(pen).toBeLessThanOrEqual((lobes - turns) * 0.65 + 1e-9);
        }
      }
    }
  });

  it("draws each ring inside its band, sampled at 40 points per lobe, at most 800 (design §9 budget)", () => {
    for (const g of [geometry, seal(A, 64)]) {
      const c = g.size / 2;
      for (const r of g.rings) {
        expect(r.points).toBe(SAMPLES_PER_LOBE * r.lobes);
        expect(r.points).toBeLessThanOrEqual(MAX_POINTS);
        expect(points(r.d)).toHaveLength(r.points);
        for (const [x, y] of points(r.d)) {
          const radius = Math.hypot(x - c, y - c);
          expect(radius).toBeGreaterThanOrEqual(r.band[0] - 0.02);
          expect(radius).toBeLessThanOrEqual(r.band[1] + 0.02);
        }
      }
    }
    expect(geometry.rings.map((r) => r.band)).toEqual(BANDS);
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

  it("strokes 0.75 px at 200 px, but never thinner than one device pixel", () => {
    expect(sealStroke(200, 2)).toBe(0.75);
    expect(seal(A, 200, { devicePixelRatio: 2 }).strokeWidth).toBe(0.75);
    expect(geometry.strokeWidth).toBe(1);
    expect(sealStroke(64, 2)).toBe(0.5);
    expect(sealStroke(64, 3)).toBeCloseTo(1 / 3, 12);
    expect(sealStroke(320, 2)).toBeCloseTo(1.2, 10);
    expect(sealStroke(200, Number.NaN)).toBe(1);
    // The stroke never changes the drawing: the paths are the same on every device.
    expect(seal(A, 200, { devicePixelRatio: 3 }).rings).toEqual(geometry.rings);
  });

  it("scales with size within a variant", () => {
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
    const small = seal(A, 64).rings;
    expect(small.map((r) => isRingSigned(r, 1))).toEqual([true, false]);
    expect(small.map((r) => isRingSigned(r, 2))).toEqual([true, true]);
  });

  it("draws unsigned bands as 1 px rule circles", () => {
    const none = sealSvg(A, 200, { keys: 0 });
    expect(none.match(/<circle /g)).toHaveLength(5);
    expect(none.match(/<path /g)).toBeNull();
    const one = sealSvg(A, 200, { keys: 1 });
    expect(one.match(/<path /g)).toHaveLength(3);
    expect(one.match(/<circle /g)).toHaveLength(2);
    expect(bandCircle(4, 200)).toEqual({ cx: 100, cy: 100, r: 93 });
    expect(ringBandCircle(seal(A, 200).rings[4] ?? { band: [0, 0] }, 200)).toEqual({
      cx: 100,
      cy: 100,
      r: 93,
    });
    const small = sealSvg(A, 64, { keys: 1 });
    expect(small.match(/<path /g)).toHaveLength(1);
    expect(small.match(/<circle /g)).toHaveLength(1);
  });

  it("produces a standalone, titled SVG for the sharp PNG path", () => {
    const svg = sealSvg(A, 512, { background: "#FFFFFF" });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="512"')).toBe(true);
    expect(svg).toContain(`<title>Batch seal ${hashGroups(A)}</title>`);
    expect(svg.length).toBeLessThan(200_000);
  });

  it("prints five rings at 48 mm with 0.25 mm strokes for the 203 dpi head", () => {
    expect(SEAL_PRINT).toMatchObject({ mm: 48, strokeMm: 0.25, dpi: 203, px: 384, strokePx: 2 });
    const svg = sealPrintSvg(A);
    expect(svg).toContain('width="384"');
    expect(svg.match(/<path /g)).toHaveLength(5);
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke="#000000"');
  });

  it("writes hashes in groups of four, and the seal's cross-check as the first 16 digits", () => {
    expect(hashGroups("7F3A91C2DEADBEEF")).toBe("7f3a 91c2");
    expect(hashGroups("7f3a91c2deadbeef", 4)).toBe("7f3a 91c2 dead beef");
    expect(sealHash(A)).toBe(`${A.slice(0, 4)} ${A.slice(4, 8)} ${A.slice(8, 12)} ${A.slice(12, 16)}`);
  });
});
