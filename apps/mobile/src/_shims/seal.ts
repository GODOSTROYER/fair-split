/**
 * TEMPORARY SHIM: replace with @fairsplit/seal `seal(batchSha256, size)` after WS-DS merges.
 *
 * A literal implementation of the revised S2.7 seal, so the Chair can compare the phone's seal with the console's by
 * eye: five hypotrochoid rings whose parameters come from the 32 bytes of the batch hash; rings 0–2 belong to key 1
 * and rings 3–4 to key 2. Below 96 px a two-ring variant keeps the guilloché legible. Pure: returns path data.
 *
 * - Lobes N = 10 + b[i] % 11; turns M = 2 + b[5+i] % 4, stepped within 2–5 until gcd(N, M) = 1.
 * - Pen p = (N − M)(0.45 + 0.20·b[15+i]/255).
 * - x = (N−M)cos t + p cos((N−M)t/M), y = (N−M)sin t − p sin((N−M)t/M), t ∈ [0, 2πM], 40N samples.
 * - The polar radius is remapped linearly into the ring's band, then the ring turns by 2π·b[10+i]/256/N.
 */

export interface SealRing {
  /** SVG path data, in a `size × size` box centred on (size/2, size/2). */
  d: string;
  /** Polyline length: react-native-svg has no `pathLength`, so engraving dashes need it. */
  length: number;
  owner: 1 | 2;
  /** Mid-band radius in px, for the 1 px rule circle drawn while the band is unsigned. */
  bandRadius: number;
  /** Inner and outer radius of the band, in px. */
  band: readonly [number, number];
  points: number;
}

/** Bands of the five-ring seal, in units of size/200. */
export const BANDS: readonly (readonly [number, number])[] = [
  [22, 38],
  [40, 56],
  [58, 72],
  [76, 86],
  [88, 98],
];

/** The two-ring variant below 96 px: key 1 from ring 0's bytes, key 2 from ring 3's bytes. */
export const SMALL_BANDS: readonly (readonly [number, number])[] = [
  [30, 62],
  [70, 98],
];
export const SMALL_SEAL_MAX = 96;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return x;
}

export function digestBytes(hex: string): number[] {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new RangeError("batchSha256 must be 64 hex characters");
  const out: number[] = [];
  for (let i = 0; i < 64; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number) => {
  const r = round2(v);
  return Object.is(r, -0) ? "0" : String(r);
};

export interface RingParameters {
  lobes: number;
  turns: number;
  pen: number;
  rotation: number;
}

/** Ring parameters from the hash bytes: `byteIndex` picks which ring's bytes drive it. */
export function ringParameters(b: readonly number[], byteIndex: number, small = false): RingParameters {
  const lobes = small ? 6 + ((b[byteIndex] ?? 0) % 7) : 10 + ((b[byteIndex] ?? 0) % 11);
  const lo = 2;
  const hi = small ? 3 : 5;
  let turns = lo + ((b[5 + byteIndex] ?? 0) % (hi - lo + 1));
  for (let step = 0; step <= hi - lo && gcd(lobes, turns) !== 1; step++) turns = turns >= hi ? lo : turns + 1;
  const pen = (lobes - turns) * (0.45 + (0.2 * (b[15 + byteIndex] ?? 0)) / 255);
  const rotation = (2 * Math.PI * (b[10 + byteIndex] ?? 0)) / 256 / lobes;
  return { lobes, turns, pen, rotation };
}

function ring(params: RingParameters, band: readonly [number, number], size: number, owner: 1 | 2): SealRing {
  const { lobes: N, turns: M, pen: p, rotation } = params;
  const k = N - M;
  const unit = size / 200;
  const c = size / 2;
  const [lo, hi] = band;
  const inner = k - p;
  const span = 2 * p;
  const samples = 40 * N;
  const tMax = 2 * Math.PI * M;
  const coords: string[] = [];
  let length = 0;
  let first: [number, number] | null = null;
  let prev: [number, number] | null = null;
  for (let s = 0; s < samples; s++) {
    const t = (tMax * s) / samples;
    const x = k * Math.cos(t) + p * Math.cos((k * t) / M);
    const y = k * Math.sin(t) - p * Math.sin((k * t) / M);
    const rho = Math.hypot(x, y);
    const theta = Math.atan2(y, x) + rotation;
    const radius = (lo + ((rho - inner) / span) * (hi - lo)) * unit;
    const px = round2(c + radius * Math.cos(theta));
    const py = round2(c + radius * Math.sin(theta));
    coords.push(`${num(px)} ${num(py)}`);
    if (prev) length += Math.hypot(px - prev[0], py - prev[1]);
    else first = [px, py];
    prev = [px, py];
  }
  if (first && prev) length += Math.hypot(first[0] - prev[0], first[1] - prev[1]);
  return {
    d: `M${coords[0]}L${coords.slice(1).join(" ")}Z`,
    length: round2(length),
    owner,
    bandRadius: ((lo + hi) / 2) * unit,
    band: [lo * unit, hi * unit],
    points: samples,
  };
}

/** Grows the seal for a batch hash at a pixel size: five rings, or two below 96 px. */
export function seal(batchSha256: string, size: number): SealRing[] {
  if (!(size > 0) || !Number.isFinite(size)) throw new RangeError("The seal needs a positive size");
  const b = digestBytes(batchSha256);
  if (size < SMALL_SEAL_MAX) {
    return [
      ring(ringParameters(b, 0, true), SMALL_BANDS[0] ?? [30, 62], size, 1),
      ring(ringParameters(b, 3, true), SMALL_BANDS[1] ?? [70, 98], size, 2),
    ];
  }
  return BANDS.map((band, i) => ring(ringParameters(b, i), band, size, i < 3 ? 1 : 2));
}

/** Stroke width for the guilloché lines: max(1 device px, 0.75·size/200) (S2.7). */
export const sealStroke = (size: number, devicePx = 1) => Math.max(devicePx, (0.75 * size) / 200);
