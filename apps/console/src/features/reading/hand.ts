// Jessie's hand: the blue ballpoint block capitals every slip is written in (register §1, design §2.6). The
// evidence on the console is drawn from the seed's slip boxes until WS-MEDIA's photographs and reviewed crop
// fixtures land (IC-11), so the writing is single-stroke geometry, not a font: each capital is a few polylines
// on a 4 × 6 grid, and each stroke wobbles a little, deterministically, the way a hand never repeats itself.
// Pure: one string in, one SVG path out, the same every render (seeded by the slip and the box).

type Pt = readonly [number, number];
type Stroke = readonly Pt[];

interface GlyphDef {
  /** Advance width in grid units (the cap height is 6). */
  readonly w: number;
  readonly strokes: readonly Stroke[];
}

const O_RING: Stroke = [
  [1.2, 0.1],
  [0.25, 1.1],
  [0.15, 3],
  [0.25, 4.9],
  [1.2, 5.9],
  [2.8, 5.9],
  [3.75, 4.9],
  [3.85, 3],
  [3.75, 1.1],
  [2.8, 0.1],
  [1.2, 0.1],
];

const P_BOWL: Stroke = [
  [0, 6],
  [0, 0],
  [2.7, 0],
  [3.6, 0.8],
  [3.6, 2.4],
  [2.7, 3.2],
  [0, 3.2],
];

const GLYPHS: Readonly<Record<string, GlyphDef>> = {
  A: {
    w: 4,
    strokes: [
      [
        [0, 6],
        [2, 0],
        [4, 6],
      ],
      [
        [0.75, 4],
        [3.25, 4],
      ],
    ],
  },
  B: {
    w: 3.9,
    strokes: [
      [
        [0, 6],
        [0, 0],
        [2.7, 0],
        [3.5, 0.6],
        [3.5, 2.2],
        [2.7, 2.9],
        [0, 2.9],
      ],
      [
        [2.7, 2.9],
        [3.8, 3.6],
        [3.8, 5.3],
        [3, 6],
        [0, 6],
      ],
    ],
  },
  C: {
    w: 3.9,
    strokes: [
      [
        [3.8, 1],
        [3, 0.1],
        [1.2, 0.1],
        [0.2, 1.2],
        [0.15, 3],
        [0.2, 4.8],
        [1.2, 5.9],
        [3, 5.9],
        [3.8, 5],
      ],
    ],
  },
  D: {
    w: 3.9,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [2.3, 6],
        [3.5, 5],
        [3.85, 3],
        [3.5, 1],
        [2.3, 0],
        [0, 0],
      ],
    ],
  },
  E: {
    w: 3.6,
    strokes: [
      [
        [3.6, 0],
        [0, 0],
        [0, 6],
        [3.6, 6],
      ],
      [
        [0, 2.9],
        [2.8, 2.9],
      ],
    ],
  },
  F: {
    w: 3.5,
    strokes: [
      [
        [3.5, 0],
        [0, 0],
        [0, 6],
      ],
      [
        [0, 2.9],
        [2.7, 2.9],
      ],
    ],
  },
  G: {
    w: 4,
    strokes: [
      [
        [3.7, 1],
        [3, 0.1],
        [1.2, 0.1],
        [0.2, 1.2],
        [0.15, 3],
        [0.2, 4.8],
        [1.2, 5.9],
        [3, 5.9],
        [3.85, 5],
        [3.85, 3.4],
        [2.2, 3.4],
      ],
    ],
  },
  H: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [0, 6],
      ],
      [
        [4, 0],
        [4, 6],
      ],
      [
        [0, 3],
        [4, 3],
      ],
    ],
  },
  I: {
    w: 2,
    strokes: [
      [
        [0, 0],
        [2, 0],
      ],
      [
        [1, 0],
        [1, 6],
      ],
      [
        [0, 6],
        [2, 6],
      ],
    ],
  },
  J: {
    w: 3.2,
    strokes: [
      [
        [3.1, 0],
        [3.1, 4.8],
        [2.3, 5.9],
        [0.9, 5.9],
        [0.1, 4.9],
      ],
    ],
  },
  K: {
    w: 3.9,
    strokes: [
      [
        [0, 0],
        [0, 6],
      ],
      [
        [3.8, 0],
        [0, 3.6],
      ],
      [
        [1.2, 2.5],
        [3.9, 6],
      ],
    ],
  },
  L: {
    w: 3.4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [3.4, 6],
      ],
    ],
  },
  M: {
    w: 4.4,
    strokes: [
      [
        [0, 6],
        [0, 0],
        [2.2, 3.7],
        [4.4, 0],
        [4.4, 6],
      ],
    ],
  },
  N: {
    w: 4,
    strokes: [
      [
        [0, 6],
        [0, 0],
        [4, 6],
        [4, 0],
      ],
    ],
  },
  O: { w: 4, strokes: [O_RING] },
  P: { w: 3.7, strokes: [P_BOWL] },
  Q: {
    w: 4,
    strokes: [
      O_RING,
      [
        [2.4, 4.4],
        [4.1, 6.3],
      ],
    ],
  },
  R: {
    w: 3.9,
    strokes: [
      P_BOWL,
      [
        [1.8, 3.2],
        [3.9, 6],
      ],
    ],
  },
  S: {
    w: 3.9,
    strokes: [
      [
        [3.7, 0.9],
        [2.9, 0.1],
        [1.1, 0.1],
        [0.2, 0.9],
        [0.2, 2.2],
        [1, 2.9],
        [3, 3.1],
        [3.8, 3.8],
        [3.8, 5.1],
        [2.9, 5.9],
        [1, 5.9],
        [0.1, 5.1],
      ],
    ],
  },
  T: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [2, 0],
        [2, 6],
      ],
    ],
  },
  U: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [0, 4.8],
        [1, 5.9],
        [3, 5.9],
        [4, 4.8],
        [4, 0],
      ],
    ],
  },
  V: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [2, 6],
        [4, 0],
      ],
    ],
  },
  W: {
    w: 5,
    strokes: [
      [
        [0, 0],
        [1.2, 6],
        [2.5, 2.4],
        [3.8, 6],
        [5, 0],
      ],
    ],
  },
  X: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [4, 6],
      ],
      [
        [4, 0],
        [0, 6],
      ],
    ],
  },
  Y: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [2, 3],
        [4, 0],
      ],
      [
        [2, 3],
        [2, 6],
      ],
    ],
  },
  Z: {
    w: 4,
    strokes: [
      [
        [0, 0],
        [4, 0],
        [0, 6],
        [4, 6],
      ],
    ],
  },
  Ñ: {
    w: 4,
    strokes: [
      [
        [0, 6],
        [0, 0],
        [4, 6],
        [4, 0],
      ],
      [
        [0.6, -0.9],
        [1.4, -1.4],
        [2.6, -0.8],
        [3.4, -1.3],
      ],
    ],
  },
  "0": {
    w: 3.7,
    strokes: [
      [
        [1.2, 0.1],
        [0.3, 1.2],
        [0.2, 3],
        [0.3, 4.8],
        [1.2, 5.9],
        [2.5, 5.9],
        [3.4, 4.8],
        [3.5, 3],
        [3.4, 1.2],
        [2.5, 0.1],
        [1.2, 0.1],
      ],
    ],
  },
  "1": {
    w: 2.4,
    strokes: [
      [
        [0.3, 1.3],
        [1.7, 0],
        [1.7, 6],
      ],
    ],
  },
  "2": {
    w: 3.8,
    strokes: [
      [
        [0.3, 1.2],
        [1.2, 0.1],
        [2.7, 0.1],
        [3.6, 1.1],
        [3.6, 2.2],
        [0.2, 6],
        [3.8, 6],
      ],
    ],
  },
  "3": {
    w: 3.8,
    strokes: [
      [
        [0.3, 0.6],
        [1.2, 0.1],
        [2.7, 0.1],
        [3.5, 0.9],
        [3.5, 2],
        [2.6, 2.9],
        [1.4, 2.9],
      ],
      [
        [2.6, 2.9],
        [3.7, 3.8],
        [3.7, 5],
        [2.8, 5.9],
        [1.1, 5.9],
        [0.2, 5.2],
      ],
    ],
  },
  "4": {
    w: 3.9,
    strokes: [
      [
        [2.9, 6],
        [2.9, 0],
        [0, 4.1],
        [3.9, 4.1],
      ],
    ],
  },
  "5": {
    w: 3.8,
    strokes: [
      [
        [3.5, 0],
        [0.5, 0],
        [0.3, 2.7],
        [1.2, 2.3],
        [2.7, 2.3],
        [3.7, 3.2],
        [3.7, 5],
        [2.8, 5.9],
        [1.1, 5.9],
        [0.2, 5.1],
      ],
    ],
  },
  "6": {
    w: 3.8,
    strokes: [
      [
        [3.3, 0.5],
        [2.5, 0.1],
        [1.3, 0.1],
        [0.3, 1.3],
        [0.2, 4.7],
        [1.2, 5.9],
        [2.7, 5.9],
        [3.7, 4.9],
        [3.7, 3.6],
        [2.7, 2.7],
        [1.2, 2.7],
        [0.2, 3.6],
      ],
    ],
  },
  "7": {
    w: 3.7,
    strokes: [
      [
        [0, 0],
        [3.7, 0],
        [1.3, 6],
      ],
    ],
  },
  "8": {
    w: 3.8,
    strokes: [
      [
        [1.9, 2.9],
        [0.6, 2.2],
        [0.5, 0.9],
        [1.3, 0.1],
        [2.6, 0.1],
        [3.4, 0.9],
        [3.3, 2.2],
        [1.9, 2.9],
        [0.3, 3.8],
        [0.2, 5],
        [1.1, 5.9],
        [2.8, 5.9],
        [3.7, 5],
        [3.6, 3.8],
        [1.9, 2.9],
      ],
    ],
  },
  "9": {
    w: 3.8,
    strokes: [
      [
        [3.7, 2.4],
        [2.7, 3.3],
        [1.2, 3.3],
        [0.2, 2.4],
        [0.2, 1.1],
        [1.2, 0.1],
        [2.7, 0.1],
        [3.7, 1.1],
        [3.7, 4.6],
        [2.7, 5.9],
        [1.2, 5.9],
        [0.4, 5.4],
      ],
    ],
  },
  ".": {
    w: 0.8,
    strokes: [
      [
        [0.35, 5.65],
        [0.45, 6],
      ],
    ],
  },
  ",": {
    w: 0.9,
    strokes: [
      [
        [0.6, 5.5],
        [0.25, 6.9],
      ],
    ],
  },
  ":": {
    w: 0.8,
    strokes: [
      [
        [0.35, 1.8],
        [0.45, 2.15],
      ],
      [
        [0.35, 5.65],
        [0.45, 6],
      ],
    ],
  },
  "/": {
    w: 3,
    strokes: [
      [
        [3, -0.2],
        [0, 6.2],
      ],
    ],
  },
  "-": {
    w: 2.6,
    strokes: [
      [
        [0.3, 3.2],
        [2.3, 3.15],
      ],
    ],
  },
  "(": {
    w: 1.7,
    strokes: [
      [
        [1.6, -0.3],
        [0.4, 1.5],
        [0.3, 4.5],
        [1.6, 6.3],
      ],
    ],
  },
  ")": {
    w: 1.7,
    strokes: [
      [
        [0.1, -0.3],
        [1.3, 1.5],
        [1.4, 4.5],
        [0.1, 6.3],
      ],
    ],
  },
  "₱": {
    w: 4,
    strokes: [
      P_BOWL,
      [
        [-0.5, 1.05],
        [4.2, 1.05],
      ],
      [
        [-0.5, 2.15],
        [4.2, 2.15],
      ],
    ],
  },
  " ": { w: 2.2, strokes: [] },
};

/** Space between letters, in grid units. */
const TRACK = 1.15;
/** Lower case on a slip is written as small capitals. */
const SMALL = 0.74;

/** A small deterministic generator: the same slip always gets the same wobble. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HandOptions {
  /** Cap height in px (user units of the drawing). */
  readonly size: number;
  /** Seeds the wobble: the slip serial and the box. */
  readonly seed: string;
  /** How much the hand shakes, 0 to 1 (a pink carbon copy is softer, a hurried note shakier). */
  readonly wobble?: number;
}

export interface HandGlyph {
  readonly char: string;
  /** Left edge and advance in px, from the start of the run. */
  readonly x: number;
  readonly w: number;
  /** This glyph's strokes alone (a stain hides one digit of a run). */
  readonly d: string;
}

export interface HandRun {
  /** SVG path data, origin at the run's top-left (cap top), y down. */
  readonly d: string;
  readonly width: number;
  readonly height: number;
  readonly glyphs: readonly HandGlyph[];
  /** Characters the hand has no strokes for (should be empty for every seeded box). */
  readonly missing: readonly string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Writes `text` in Jessie's hand. Each glyph leans a little right, sits a little off the baseline, turns a
 * little, and every point wanders by a fraction of a stroke: enough to read as a person, never enough to
 * change a digit.
 */
export function handRun(text: string, options: HandOptions): HandRun {
  const unit = options.size / 6;
  const wobble = options.wobble ?? 1;
  const rand = seeded(`${options.seed}|${text}`);
  const jitter = (amount: number) => (rand() * 2 - 1) * amount * wobble;
  const parts: string[] = [];
  const glyphs: HandGlyph[] = [];
  const missing: string[] = [];
  let cursor = 0;
  for (const raw of text) {
    const upper = raw.toUpperCase();
    const def = GLYPHS[raw] ?? GLYPHS[upper];
    if (!def) {
      missing.push(raw);
      continue;
    }
    const small = raw !== upper && GLYPHS[raw] === undefined;
    const k = small ? SMALL : 1;
    const width = def.w * k;
    const lean = 0.07 + jitter(0.03);
    const turn = jitter(0.045);
    const lift = jitter(0.22);
    const stretch = 1 + jitter(0.06);
    const cx = width / 2;
    const cy = 3;
    const own: string[] = [];
    for (const stroke of def.strokes) {
      const points = stroke.map(([gx, gy]) => {
        // Small capitals sit on the baseline.
        let x = gx * k * stretch;
        let y = small ? 6 - (6 - gy) * k : gy;
        x += lean * (6 - y);
        x += jitter(0.11);
        y += jitter(0.11) + lift;
        // Turn about the glyph's centre.
        const dx = x - cx;
        const dy = y - cy;
        const rx = cx + dx * Math.cos(turn) - dy * Math.sin(turn);
        const ry = cy + dx * Math.sin(turn) + dy * Math.cos(turn);
        return [r2((cursor + rx) * unit), r2(ry * unit)] as const;
      });
      const [first, ...rest] = points;
      if (!first) continue;
      own.push(`M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join("")}`);
    }
    parts.push(...own);
    glyphs.push({ char: raw, x: r2(cursor * unit), w: r2(width * unit), d: own.join("") });
    cursor += width + TRACK * (small ? 0.9 : 1);
  }
  const width = Math.max(0, cursor - TRACK) * unit;
  return { d: parts.join(""), width: r2(width), height: options.size, glyphs, missing };
}
