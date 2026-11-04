// The batch seal (design §5, S2 §2.7): hypotrochoid rings whose lobes, turns, pen offset and rotation come from
// the 32 bytes of the batch digest. One pure function feeds inline SVG on the web, react-native-svg on native,
// and the sharp-rendered PNG for push notifications and the 80 mm print, so every surface draws the same seal
// for the same batch. The inner rings belong to key 1 (the treasurer), the outer ones to key 2 (the Chair): a
// person can compare the console and the phone by eye. It is a recognizer, not a check: the phone recomputes
// batchSha256 from the items it shows, and the seal plus both ends of its digest let a person cross-check.
//
// The ranges come from S2's coverage simulation (1 px stroke, 200 px seal): the old ones covered 40% of a band
// at the median and 66% at the 95th percentile, which reads as grey moiré; these keep each band at 12–40%
// (seal.density.test.ts). Below 96 px the seal draws two rings, one per key, so it stays legible at 64 px.

export type RingIndex = 0 | 1 | 2 | 3 | 4;
export type KeyNumber = 1 | 2;
export type KeysSigned = 0 | 1 | 2;
export type SealVariant = "five" | "two";

/** Radial bands of the five-ring seal in units of size/200, inner to outer. */
export const BANDS: readonly (readonly [number, number])[] = [
  [22, 38],
  [40, 56],
  [58, 72],
  [76, 86],
  [88, 98],
];

/** Rings 0–2 belong to key 1, rings 3–4 to key 2. */
export const RING_OWNER: readonly KeyNumber[] = [1, 1, 1, 2, 2];

/** Below this size the seal draws the two-ring variant (S2 §2.7). */
export const TWO_RING_BELOW = 96;

/**
 * The two-ring variant: key 1's ring sits in [30, 62] and grows from ring 0's bytes; key 2's ring sits in
 * [70, 98] and grows from ring 3's bytes.
 */
export const SMALL_RINGS: readonly {
  readonly band: readonly [number, number];
  readonly bytes: RingIndex;
  readonly owner: KeyNumber;
}[] = [
  { band: [30, 62], bytes: 0, owner: 1 },
  { band: [70, 98], bytes: 3, owner: 2 },
];

/** Samples per lobe: a ring with N lobes is sampled at 40·N points (S2 §2.7), at most 800. */
export const SAMPLES_PER_LOBE = 40;
/** Design §9 budget: at most 5 paths of at most 800 points. */
export const MAX_POINTS = 800;

/** The parameter ranges, inclusive (S2 §2.7). */
export const RANGES = {
  five: { lobes: [10, 20], turns: [2, 5] },
  two: { lobes: [6, 12], turns: [2, 3] },
  pen: [0.45, 0.65],
} as const;

/** The 80 mm print: five rings at 48 mm with 0.25 mm strokes, for a 203 dpi thermal head (S2 §2.7). */
export const SEAL_PRINT = {
  mm: 48,
  strokeMm: 0.25,
  dpi: 203,
  /** 48 mm at 203 dpi. */
  px: Math.round((48 / 25.4) * 203),
  /** 0.25 mm at 203 dpi, in px. */
  strokePx: Math.round((0.25 / 25.4) * 203 * 100) / 100,
} as const;

export interface SealRing {
  /** 0–4 on the five-ring seal; 0–1 on the two-ring variant. */
  readonly index: number;
  /** The five-ring index whose bytes grew this ring (the two-ring variant grows from rings 0 and 3). */
  readonly source: RingIndex;
  readonly owner: KeyNumber;
  /** SVG path data in the seal's own pixel space (0..size), closed. */
  readonly d: string;
  /** Polyline length in px; react-native-svg has no pathLength, so dash animation needs it. */
  readonly length: number;
  readonly points: number;
  /** Band in px: inner and outer radius. */
  readonly band: readonly [number, number];
  readonly lobes: number;
  readonly turns: number;
  readonly pen: number;
  /** Rotation in radians. */
  readonly rotation: number;
}

export interface SealGeometry {
  readonly digest: string;
  readonly size: number;
  readonly center: number;
  readonly variant: SealVariant;
  readonly strokeWidth: number;
  readonly rings: readonly SealRing[];
}

export interface SealOptions {
  /** Device pixels per CSS pixel. The stroke is never thinner than one device pixel. Defaults to 1. */
  readonly devicePixelRatio?: number;
}

/** Parses a 64-character hex sha256 digest into its 32 bytes. */
export function digestBytes(digest: string): Uint8Array {
  const hex = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("The seal needs a sha256 digest: 64 hexadecimal characters");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

const byte = (b: Uint8Array, i: number) => b[i] ?? 0;
const round2 = (v: number) => Math.round(v * 100) / 100;
/** Formats a coordinate at 0.01 precision without trailing zeros or "-0". */
const num = (v: number) => {
  const r = round2(v);
  return Object.is(r, -0) ? "0" : String(r);
};

export interface RingParameters {
  readonly lobes: number;
  readonly turns: number;
  readonly pen: number;
  readonly rotation: number;
}

/**
 * The ring parameters grown from ring `i`'s bytes, exactly as S2 §2.7 specifies them:
 * N = 10 + b[i] % 11, M = 2 + b[5+i] % 4 stepped within 2–5 until gcd(N, M) = 1,
 * p = (N − M)(0.45 + 0.20·b[15+i]/255), rotation 2π·b[10+i]/256/N.
 *
 * The two-ring variant uses N = 6 + b[i] % 7 and M within 2–3. Neither 2 nor 3 is coprime with 6 or 12, so
 * those two lobe counts step to 7 and 11.
 */
export function ringParameters(
  bytes: Uint8Array,
  i: RingIndex,
  variant: SealVariant = "five",
): RingParameters {
  const range = RANGES[variant];
  const [nMin, nMax] = range.lobes;
  const [mMin, mMax] = range.turns;
  let lobes = nMin + (byte(bytes, i) % (nMax - nMin + 1));
  const coprimeTurn = (n: number) => {
    for (let m = mMin; m <= mMax; m++) if (gcd(n, m) === 1) return true;
    return false;
  };
  while (!coprimeTurn(lobes)) lobes = lobes === nMax ? nMax - 1 : lobes + 1;
  let turns = mMin + (byte(bytes, 5 + i) % (mMax - mMin + 1));
  while (gcd(lobes, turns) !== 1) turns = turns === mMax ? mMin : turns + 1;
  const [pLo, pHi] = RANGES.pen;
  const pen = (lobes - turns) * (pLo + ((pHi - pLo) * byte(bytes, 15 + i)) / 255);
  const rotation = (2 * Math.PI * byte(bytes, 10 + i)) / 256 / lobes;
  return { lobes, turns, pen, rotation };
}

/** One ring as numbers: what the path data spells out, point for point. */
export interface RingPolyline {
  readonly index: number;
  readonly source: RingIndex;
  readonly owner: KeyNumber;
  /** Band in px: inner and outer radius. */
  readonly band: readonly [number, number];
  /** x0, y0, x1, y1, … in the seal's pixel space, each rounded to 0.01 px. The polyline is closed. */
  readonly xy: Float64Array;
  readonly parameters: RingParameters;
}

interface RingSpec {
  readonly source: RingIndex;
  readonly variant: SealVariant;
  readonly index: number;
  readonly owner: KeyNumber;
  readonly band: readonly [number, number];
}

function polyline(bytes: Uint8Array, spec: RingSpec, size: number): RingPolyline {
  const parameters = ringParameters(bytes, spec.source, spec.variant);
  const { lobes: N, turns: M, pen: p, rotation } = parameters;
  const k = N - M;
  const unit = size / 200;
  const c = size / 2;
  const [lo, hi] = spec.band;
  const inner = k - p;
  const outer = k + p;
  const samples = SAMPLES_PER_LOBE * N;
  const xy = new Float64Array(samples * 2);
  for (let s = 0; s < samples; s++) {
    const t = (2 * Math.PI * M * s) / samples;
    const x = k * Math.cos(t) + p * Math.cos((k * t) / M);
    const y = k * Math.sin(t) - p * Math.sin((k * t) / M);
    const rho = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(y, x) + rotation;
    const radius = (lo + ((rho - inner) / (outer - inner)) * (hi - lo)) * unit;
    xy[2 * s] = round2(c + radius * Math.cos(theta));
    xy[2 * s + 1] = round2(c + radius * Math.sin(theta));
  }
  return {
    index: spec.index,
    source: spec.source,
    owner: spec.owner,
    band: [round2(lo * unit), round2(hi * unit)],
    xy,
    parameters,
  };
}

function ringSpecs(size: number): RingSpec[] {
  return sealVariant(size) === "five"
    ? ([0, 1, 2, 3, 4] as const).map((i) => ({
        source: i,
        variant: "five" as const,
        index: i,
        owner: RING_OWNER[i] ?? 1,
        band: BANDS[i] ?? [0, 0],
      }))
    : SMALL_RINGS.map((r, i) => ({
        source: r.bytes,
        variant: "two" as const,
        index: i,
        owner: r.owner,
        band: r.band,
      }));
}

/** The seal's rings as numbers, for measuring and for renderers that draw points rather than path data. */
export function sealPolylines(batchSha256: string, size: number): RingPolyline[] {
  if (!(size > 0) || !Number.isFinite(size)) throw new Error("The seal needs a positive size");
  const bytes = digestBytes(batchSha256);
  return ringSpecs(size).map((spec) => polyline(bytes, spec, size));
}

function ring(line: RingPolyline): SealRing {
  const { xy } = line;
  const n = xy.length / 2;
  // Every point sits at least size/2 − 0.98·size/2 from the edge, so coordinates are positive: plain String()
  // of a value already rounded to 0.01 is the canonical form (no "-0", no trailing zeros).
  let d = `M${xy[0]} ${xy[1]}L`;
  let length = 0;
  for (let s = 1; s < n; s++) {
    const x = xy[2 * s] ?? 0;
    const y = xy[2 * s + 1] ?? 0;
    d += s === 1 ? `${x} ${y}` : ` ${x} ${y}`;
    const dx = x - (xy[2 * s - 2] ?? 0);
    const dy = y - (xy[2 * s - 1] ?? 0);
    length += Math.sqrt(dx * dx + dy * dy);
  }
  const dx = (xy[0] ?? 0) - (xy[2 * n - 2] ?? 0);
  const dy = (xy[1] ?? 0) - (xy[2 * n - 1] ?? 0);
  length += Math.sqrt(dx * dx + dy * dy);
  return {
    index: line.index,
    source: line.source,
    owner: line.owner,
    d: `${d}Z`,
    length: round2(length),
    points: n,
    band: line.band,
    lobes: line.parameters.lobes,
    turns: line.parameters.turns,
    pen: line.parameters.pen,
    rotation: line.parameters.rotation,
  };
}

/** The stroke: never thinner than one device pixel, otherwise 0.75 px at 200 px (S2 §2.7). */
export function sealStroke(size: number, devicePixelRatio = 1): number {
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return Math.max(1 / dpr, (0.75 * size) / 200);
}

/** Which variant a seal of this size draws. */
export function sealVariant(size: number): SealVariant {
  return size < TWO_RING_BELOW ? "two" : "five";
}

/** Grows the seal for a batch digest at a pixel size. Pure and deterministic. */
export function seal(batchSha256: string, size: number, options: SealOptions = {}): SealGeometry {
  const rings = sealPolylines(batchSha256, size).map(ring);
  return {
    digest: batchSha256.trim().toLowerCase(),
    size,
    center: size / 2,
    variant: sealVariant(size),
    strokeWidth: sealStroke(size, options.devicePixelRatio),
    rings,
  };
}

/** Whether a ring is engraved once `keys` signatures are in: key 1 engraves the inner rings, key 2 the rest. */
export function isRingSigned(ring: Pick<SealRing, "owner">, keys: KeysSigned): boolean {
  return ring.owner <= keys;
}

/** Whether ring `ringIndex` of the five-ring seal is engraved once `keys` signatures are in. */
export function isSigned(ringIndex: RingIndex, keys: KeysSigned): boolean {
  return (RING_OWNER[ringIndex] ?? 2) <= keys;
}

/** The 1 px circle drawn in place of an unsigned ring, at the middle of its band. */
export function ringBandCircle(
  ring: Pick<SealRing, "band">,
  size: number,
): { cx: number; cy: number; r: number } {
  return { cx: size / 2, cy: size / 2, r: (ring.band[0] + ring.band[1]) / 2 };
}

/** The 1 px circle for ring `ringIndex` of the five-ring seal. */
export function bandCircle(ringIndex: RingIndex, size: number): { cx: number; cy: number; r: number } {
  const [lo, hi] = BANDS[ringIndex] ?? [0, 0];
  return { cx: size / 2, cy: size / 2, r: (((lo + hi) / 2) * size) / 200 };
}

/** A hash written in groups of four for people to compare ("7f3a 91c2"). */
export function hashGroups(hex: string, groups = 2): string {
  const clean = hex.trim().toLowerCase();
  const parts: string[] = [];
  for (let i = 0; i < groups && i * 4 < clean.length; i++) parts.push(clean.slice(i * 4, i * 4 + 4));
  return parts.join(" ");
}

/** Cross-surface comparison: the first and last eight hex digits in groups of four. */
export function sealHash(batchSha256: string): string {
  const clean = batchSha256.trim().toLowerCase();
  return `${hashGroups(clean)} … ${hashGroups(clean.slice(-8))}`;
}

export interface SealSvgOptions {
  readonly keys?: KeysSigned;
  /** Ring colour; the product draws seals in ink (black on the 80 mm print). */
  readonly ink?: string;
  /** Colour of the unsigned band circles. */
  readonly rule?: string;
  readonly background?: string;
  readonly title?: string;
  /** Overrides the stroke, in px (the print uses SEAL_PRINT.strokePx). */
  readonly strokeWidth?: number;
}

const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch,
  );

/** A standalone SVG document: what apps/api renders to PNG with sharp for push notifications and print. */
export function sealSvg(batchSha256: string, size: number, options: SealSvgOptions = {}): string {
  const geometry = seal(batchSha256, size);
  const keys = options.keys ?? 2;
  // Hayag ink and rule (ADR-0016): the push and print seals match the product, never the v1 cacao.
  const ink = options.ink ?? "#0B1220";
  const rule = options.rule ?? "#E3E7EE";
  const stroke = options.strokeWidth ?? geometry.strokeWidth;
  const parts: string[] = [];
  if (options.background) parts.push(`<rect width="${size}" height="${size}" fill="${options.background}"/>`);
  for (const r of geometry.rings) {
    if (isRingSigned(r, keys)) {
      parts.push(
        `<path d="${r.d}" fill="none" stroke="${ink}" stroke-width="${num(stroke)}" stroke-linejoin="round"/>`,
      );
    } else {
      const c = ringBandCircle(r, size);
      parts.push(
        `<circle cx="${num(c.cx)}" cy="${num(c.cy)}" r="${num(c.r)}" fill="none" stroke="${rule}" stroke-width="1"/>`,
      );
    }
  }
  const title = escapeXml(options.title ?? `Batch seal ${hashGroups(geometry.digest)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"><title>${title}</title>${parts.join("")}</svg>`;
}

/** The seal for the 80 mm print: five rings at 48 mm with 0.25 mm strokes at 203 dpi, in ink on white. */
export function sealPrintSvg(batchSha256: string, keys: KeysSigned = 2): string {
  return sealSvg(batchSha256, SEAL_PRINT.px, {
    keys,
    ink: "#000000",
    rule: "#000000",
    background: "#FFFFFF",
    strokeWidth: SEAL_PRINT.strokePx,
  });
}

/**
 * How apps/api renders the push and print PNG with the pinned sharp (C-19): with a 4-colour palette a 512 px
 * seal on white measured 19–23 KB over 40 seeded batches (sharp 0.35.5, 22 Oct), inside the 40 KB budget.
 */
export const SEAL_PNG = {
  size: 512,
  png: { palette: true, colours: 4, compressionLevel: 9, effort: 10 },
} as const;
