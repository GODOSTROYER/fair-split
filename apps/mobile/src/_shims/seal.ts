/**
 * TEMPORARY SHIM: replace with @fairsplit/seal `seal(batchSha256, size)` after WS-DS merges.
 *
 * A literal implementation of the S2.7 seal so the board screen can compare it with the console by eye:
 * five hypotrochoid rings whose parameters come from the 32 hash bytes; rings 0–2 belong to key 1 and 3–4 to key 2.
 * Pure: returns path data, never draws.
 */

export interface SealRing {
  /** SVG path data, in a `size × size` box centred on (size/2, size/2). */
  d: string;
  /** Polyline length: react-native-svg has no `pathLength`, so engraving dashes need it. */
  length: number;
  owner: 1 | 2;
  /** Mid-band radius in px, for the 1 px rule circle drawn while the band is unsigned. */
  bandRadius: number;
}

const BANDS: readonly (readonly [number, number])[] = [
  [22, 38],
  [40, 56],
  [58, 72],
  [76, 86],
  [88, 98],
];

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return x;
}

function hexBytes(hex: string): number[] {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new RangeError("batchSha256 must be 64 hex characters");
  const out: number[] = [];
  for (let i = 0; i < 64; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function seal(batchSha256: string, size: number): SealRing[] {
  const b = hexBytes(batchSha256);
  const unit = size / 200;
  const c = size / 2;
  return BANDS.map(([lo, hi], i) => {
    const N = 12 + ((b[i] ?? 0) % 37);
    let M = 2 + ((b[5 + i] ?? 0) % 7);
    for (let step = 0; step < 7 && gcd(N, M) !== 1; step++) M = M >= 8 ? 2 : M + 1;
    const p = (N - M) * (0.35 + (0.5 * (b[15 + i] ?? 0)) / 255);
    const R = N;
    const r = M;
    const rho0 = R - r - p;
    const span = 2 * p;
    const rot = (2 * Math.PI * (b[10 + i] ?? 0)) / 256 / N;
    const samples = Math.min(2000, 24 * N);
    const tMax = 2 * Math.PI * M;
    let d = "";
    let length = 0;
    let px = 0;
    let py = 0;
    for (let k = 0; k <= samples; k++) {
      const t = (tMax * k) / samples;
      const x = (R - r) * Math.cos(t) + p * Math.cos(((R - r) * t) / r);
      const y = (R - r) * Math.sin(t) - p * Math.sin(((R - r) * t) / r);
      const rho = Math.hypot(x, y);
      const theta = Math.atan2(y, x) + rot;
      const mapped = (lo + ((rho - rho0) / span) * (hi - lo)) * unit;
      const sx = round2(c + mapped * Math.cos(theta));
      const sy = round2(c + mapped * Math.sin(theta));
      if (k === 0) d += `M${sx} ${sy}`;
      else {
        d += `L${sx} ${sy}`;
        length += Math.hypot(sx - px, sy - py);
      }
      px = sx;
      py = sy;
    }
    return { d: `${d}Z`, length: round2(length), owner: i < 3 ? 1 : 2, bandRadius: ((lo + hi) / 2) * unit };
  });
}

/** Stroke width for the guilloché lines at a given size (S2.7). */
export const sealStroke = (size: number) => Math.max(0.5, (0.75 * size) / 200);
