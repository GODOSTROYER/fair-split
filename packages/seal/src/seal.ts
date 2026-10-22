// The batch seal (design §5, S2 §2.7): five hypotrochoid rings whose lobes, turns, pen offset and rotation come
// from the 32 bytes of the batch digest. One pure function feeds inline SVG on the web, react-native-svg on
// native, and the sharp-rendered PNG for push notifications and the 80 mm print, so every surface draws the
// same seal for the same batch. The inner three rings belong to key 1 (the treasurer), the outer two to key 2
// (the Chair): a person can compare the console and the phone by eye.

export type RingIndex = 0 | 1 | 2 | 3 | 4;
export type KeyNumber = 1 | 2;
export type KeysSigned = 0 | 1 | 2;

/** Radial bands in units of size/200, inner to outer. */
export const BANDS: readonly (readonly [number, number])[] = [
  [22, 38],
  [40, 56],
  [58, 72],
  [76, 86],
  [88, 98],
];

/** Rings 0–2 belong to key 1, rings 3–4 to key 2. */
export const RING_OWNER: readonly KeyNumber[] = [1, 1, 1, 2, 2];

export const MAX_POINTS = 2000;

export interface SealRing {
  readonly index: RingIndex;
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
  readonly strokeWidth: number;
  readonly rings: readonly SealRing[];
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

/** The ring parameters for one band, exactly as S2 §2.7 specifies them. */
export function ringParameters(bytes: Uint8Array, i: RingIndex) {
  const lobes = 12 + (byte(bytes, i) % 37);
  let turns = 2 + (byte(bytes, 5 + i) % 7);
  while (gcd(lobes, turns) !== 1) turns = turns === 8 ? 2 : turns + 1;
  const pen = (lobes - turns) * (0.35 + (0.5 * byte(bytes, 15 + i)) / 255);
  const rotation = (2 * Math.PI * byte(bytes, 10 + i)) / 256 / lobes;
  return { lobes, turns, pen, rotation };
}

function ring(bytes: Uint8Array, i: RingIndex, size: number): SealRing {
  const { lobes: N, turns: M, pen: p, rotation } = ringParameters(bytes, i);
  const R = N;
  const r = M;
  const k = R - r;
  const unit = size / 200;
  const c = size / 2;
  const [lo, hi] = BANDS[i] ?? [0, 0];
  const inner = k - p;
  const outer = k + p;
  const samples = Math.min(MAX_POINTS, 24 * N);
  const coords: string[] = [];
  let length = 0;
  let first: [number, number] | null = null;
  let prev: [number, number] | null = null;
  for (let s = 0; s < samples; s++) {
    const t = (2 * Math.PI * M * s) / samples;
    const x = k * Math.cos(t) + p * Math.cos((k * t) / r);
    const y = k * Math.sin(t) - p * Math.sin((k * t) / r);
    const rho = Math.hypot(x, y);
    const theta = Math.atan2(y, x) + rotation;
    const radius = (lo + ((rho - inner) / (outer - inner)) * (hi - lo)) * unit;
    const px = round2(c + radius * Math.cos(theta));
    const py = round2(c + radius * Math.sin(theta));
    coords.push(`${num(px)} ${num(py)}`);
    if (prev) length += Math.hypot(px - prev[0], py - prev[1]);
    else first = [px, py];
    prev = [px, py];
  }
  if (first && prev) length += Math.hypot(first[0] - prev[0], first[1] - prev[1]);
  return {
    index: i,
    owner: RING_OWNER[i] ?? 1,
    d: `M${coords[0]}L${coords.slice(1).join(" ")}Z`,
    length: round2(length),
    points: samples,
    band: [lo * unit, hi * unit],
    lobes: N,
    turns: M,
    pen: p,
    rotation,
  };
}

/** Grows the seal for a batch digest at a pixel size. Pure and deterministic. */
export function seal(batchSha256: string, size: number): SealGeometry {
  if (!(size > 0) || !Number.isFinite(size)) throw new Error("The seal needs a positive size");
  const bytes = digestBytes(batchSha256);
  const rings = ([0, 1, 2, 3, 4] as const).map((i) => ring(bytes, i, size));
  return {
    digest: batchSha256.trim().toLowerCase(),
    size,
    center: size / 2,
    strokeWidth: Math.max(0.5, (0.75 * size) / 200),
    rings,
  };
}

/** Whether a ring is engraved once `keys` signatures are in: key 1 engraves rings 0–2, key 2 rings 3–4. */
export function isSigned(ringIndex: RingIndex, keys: KeysSigned): boolean {
  return (RING_OWNER[ringIndex] ?? 2) <= keys;
}

/** The 1 px circle drawn in place of an unsigned ring, at the middle of its band. */
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

export interface SealSvgOptions {
  readonly keys?: KeysSigned;
  /** Ring colour; the product draws seals in ink (black on the 80 mm print). */
  readonly ink?: string;
  /** Colour of the unsigned band circles. */
  readonly rule?: string;
  readonly background?: string;
  readonly title?: string;
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
  const ink = options.ink ?? "#1C1511";
  const rule = options.rule ?? "#D8D4CD";
  const parts: string[] = [];
  if (options.background) parts.push(`<rect width="${size}" height="${size}" fill="${options.background}"/>`);
  for (const r of geometry.rings) {
    if (isSigned(r.index, keys)) {
      parts.push(
        `<path d="${r.d}" fill="none" stroke="${ink}" stroke-width="${num(geometry.strokeWidth)}" stroke-linejoin="round"/>`,
      );
    } else {
      const c = bandCircle(r.index, size);
      parts.push(
        `<circle cx="${num(c.cx)}" cy="${num(c.cy)}" r="${num(c.r)}" fill="none" stroke="${rule}" stroke-width="1"/>`,
      );
    }
  }
  const title = escapeXml(options.title ?? `Batch seal ${hashGroups(geometry.digest)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"><title>${title}</title>${parts.join("")}</svg>`;
}

/**
 * How apps/api renders the push and print PNG with the pinned sharp (C-19): a 4-colour palette keeps a
 * 512 px seal at about 26 KB, inside the 40 KB budget (8 colours measures 46 KB).
 */
export const SEAL_PNG = {
  size: 512,
  png: { palette: true, colours: 4, compressionLevel: 9, effort: 10 },
} as const;
