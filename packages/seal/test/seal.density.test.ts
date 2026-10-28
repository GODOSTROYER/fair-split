// S2 §2.7: how much of each band the ink covers, over 2,000 seeded hashes (1 px stroke). Too much reads as grey
// moiré (the old ranges covered 40% at the median and 66% at the 95th percentile); too little reads as a
// doodle. S2 holds every band to 12–40%: the 5th and 95th percentiles must sit inside that range, and no
// single seal may leave 10–45%, so no batch ever draws an unreadable seal.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type RingPolyline, seal, sealPolylines } from "../src/seal.js";

const areas = new Map<string, number>();

/** Pixels whose centres fall inside a band. */
function bandArea(size: number, lo: number, hi: number): number {
  const key = `${size}:${lo}:${hi}`;
  const known = areas.get(key);
  if (known !== undefined) return known;
  const G = Math.ceil(size);
  const c = size / 2;
  let area = 0;
  for (let py = 0; py < G; py++)
    for (let px = 0; px < G; px++) {
      const r = Math.hypot(px + 0.5 - c, py + 0.5 - c);
      if (r >= lo && r <= hi) area++;
    }
  areas.set(key, area);
  return area;
}

/**
 * The union area of a `stroke`-px line along each ring's drawn points, over its band's area: a pixel counts when
 * its centre lies within half a stroke of the polyline.
 */
function bandCoverage(rings: readonly RingPolyline[], size: number, stroke = 1): number[] {
  const G = Math.ceil(size);
  const grid = new Uint8Array(G * G);
  const touched = new Int32Array(G * G);
  const c = size / 2;
  const half = stroke / 2;
  const half2 = half * half;
  return rings.map(({ xy, band: [lo, hi] }) => {
    const n = xy.length / 2;
    let count = 0;
    let covered = 0;
    for (let s = 0; s < n; s++) {
      const j = s + 1 === n ? 0 : s + 1;
      const x0 = xy[2 * s] ?? 0;
      const y0 = xy[2 * s + 1] ?? 0;
      const x1 = xy[2 * j] ?? 0;
      const y1 = xy[2 * j + 1] ?? 0;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const inv = 1 / (dx * dx + dy * dy || 1e-12);
      const minX = Math.max(0, Math.floor(Math.min(x0, x1) - half));
      const maxX = Math.min(G - 1, Math.ceil(Math.max(x0, x1) + half));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1) - half));
      const maxY = Math.min(G - 1, Math.ceil(Math.max(y0, y1) + half));
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const idx = py * G + px;
          if (grid[idx] === 1) continue;
          let u = ((px + 0.5 - x0) * dx + (py + 0.5 - y0) * dy) * inv;
          u = Math.max(0, Math.min(1, u));
          const ex = x0 + u * dx - px - 0.5;
          const ey = y0 + u * dy - py - 0.5;
          if (ex * ex + ey * ey > half2) continue;
          grid[idx] = 1;
          touched[count++] = idx;
          const r = Math.hypot(px + 0.5 - c, py + 0.5 - c);
          if (r >= lo && r <= hi) covered++;
        }
      }
    }
    for (let k = 0; k < count; k++) grid[touched[k] ?? 0] = 0;
    return covered / bandArea(size, lo, hi);
  });
}

const quantile = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
};

function survey(size: number, hashes: number): number[][] {
  const bands: number[][] = [];
  for (let h = 0; h < hashes; h++) {
    const digest = createHash("sha256").update(`seal-density-${h}`).digest("hex");
    bandCoverage(sealPolylines(digest, size), size).forEach((v, i) => {
      bands[i] ??= [];
      bands[i]?.push(v);
    });
  }
  return bands;
}

describe("seal density (S2 §2.7)", () => {
  it("keeps every band of the 200 px seal at 12–40% coverage over 2,000 seeded hashes", {
    timeout: 60_000,
  }, () => {
    const bands = survey(200, 2000);
    expect(bands).toHaveLength(5);
    for (const [i, values] of bands.entries()) {
      expect(values).toHaveLength(2000);
      expect(quantile(values, 0.05), `band ${i} p5`).toBeGreaterThanOrEqual(0.12);
      expect(quantile(values, 0.95), `band ${i} p95`).toBeLessThanOrEqual(0.4);
      expect(Math.min(...values), `band ${i} min`).toBeGreaterThanOrEqual(0.1);
      expect(Math.max(...values), `band ${i} max`).toBeLessThanOrEqual(0.45);
    }
  });

  it("keeps the two-ring 64 px seal legible too", { timeout: 30_000 }, () => {
    const bands = survey(64, 1000);
    expect(bands).toHaveLength(2);
    for (const [i, values] of bands.entries()) {
      expect(quantile(values, 0.05), `band ${i} p5`).toBeGreaterThanOrEqual(0.12);
      expect(quantile(values, 0.95), `band ${i} p95`).toBeLessThanOrEqual(0.4);
    }
  });

  it("measures what the path data draws: the polylines are the path's own points", () => {
    const digest = createHash("sha256").update("fs:2026A:r37:batch").digest("hex");
    const lines = sealPolylines(digest, 200);
    for (const [i, r] of seal(digest, 200).rings.entries()) {
      const nums = r.d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
      expect(nums).toEqual(Array.from(lines[i]?.xy ?? []));
    }
  });

  it("the old ranges really were moiré: a dense ring measures above the bar (a check on the measure)", () => {
    // A ring with the old maxima (48 lobes, 7 turns, pen 0.85) drawn by hand into band 0 of a 200 px seal.
    const N = 48;
    const M = 7;
    const k = N - M;
    const p = k * 0.85;
    const xy = new Float64Array(4000);
    for (let s = 0; s < 2000; s++) {
      const t = (2 * Math.PI * M * s) / 2000;
      const x = k * Math.cos(t) + p * Math.cos((k * t) / M);
      const y = k * Math.sin(t) - p * Math.sin((k * t) / M);
      const radius = 22 + ((Math.hypot(x, y) - (k - p)) / (2 * p)) * 16;
      const theta = Math.atan2(y, x);
      xy[2 * s] = 100 + radius * Math.cos(theta);
      xy[2 * s + 1] = 100 + radius * Math.sin(theta);
    }
    const dense: RingPolyline = {
      index: 0,
      source: 0,
      owner: 1,
      band: [22, 38],
      xy,
      parameters: { lobes: N, turns: M, pen: p, rotation: 0 },
    };
    expect(bandCoverage([dense], 200)[0]).toBeGreaterThan(0.4);
  });
});
