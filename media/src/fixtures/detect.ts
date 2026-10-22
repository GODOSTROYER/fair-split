import {
  apply,
  type Box,
  homography,
  type Mat3,
  type Pt,
  type Quad,
  quadSize,
  UNIT_SQUARE,
} from "./geometry.js";
import {
  close,
  components,
  downscale,
  erode,
  paperMask,
  peaks,
  quantile,
  type Raster,
  toGrey,
  warp,
} from "./raster.js";

/**
 * Draft fixture geometry from pixels, so a reviewer confirms rectangles instead of drawing 720 of them.
 * Slips: find the paper quads, rectify each slip, then find the ruled lines Codex actually drew. The paper
 * corners of a photographed slip are never exact, so lines are found shear-tolerantly: the projection
 * angle that makes the ruled lines sharpest is searched within a few degrees. Cell corners are the
 * intersections of those lines, mapped back to the photo. Pages: group text lines into blocks.
 * Every result is a draft until a person reviews it (fixtures/schema.ts).
 */

export interface DetectedQuad {
  quad: Quad;
  area: number;
  centre: Pt;
}

/** The `count` largest paper regions, as corner quads in image pixels. */
export function findPaperQuads(
  rgb: Raster,
  count: number,
  opts: { minAreaFrac?: number } = {},
): DetectedQuad[] {
  const factor = Math.max(1, Math.round(Math.max(rgb.width, rgb.height) / 480));
  const small = downscale(rgb, factor);
  const base = close(paperMask(small), small.width, small.height, 1);
  const minArea = (opts.minAreaFrac ?? 0.04) * small.width * small.height;
  // Slips lying close together can touch through bright mat fibres; erode until they separate, then
  // push each corner back out by the erosion radius.
  for (const r of [0, 2, 4, 6]) {
    const mask = r ? erode(base, small.width, small.height, r) : base;
    const comps = components(mask, small.width, small.height, minArea / (1 + r)).slice(0, count);
    if (comps.length < count && r < 6) continue;
    return comps.map((c) => {
      const s = (p: [number, number], dx: number, dy: number): Pt => [
        (p[0] + 0.5 + dx * r) * factor,
        (p[1] + 0.5 + dy * r) * factor,
      ];
      return {
        quad: [s(c.minSum, -1, -1), s(c.maxDiff, 1, -1), s(c.maxSum, 1, 1), s(c.minDiff, -1, 1)] as Quad,
        area: c.area * factor * factor,
        centre: [c.cx * factor, c.cy * factor] as Pt,
      };
    });
  }
  return [];
}

/** Orders four slip quads as TL, TR, BL, BR by their centres. */
export function orderTwoByTwo<T extends { centre: Pt }>(items: readonly T[]): { TL: T; TR: T; BL: T; BR: T } {
  if (items.length !== 4) throw new Error(`expected 4 slips, found ${items.length}`);
  const byY = [...items].sort((a, b) => a.centre[1] - b.centre[1]);
  const top = byY.slice(0, 2).sort((a, b) => a.centre[0] - b.centre[0]);
  const bottom = byY.slice(2).sort((a, b) => a.centre[0] - b.centre[0]);
  return { TL: top[0] as T, TR: top[1] as T, BL: bottom[0] as T, BR: bottom[1] as T };
}

export interface RectifiedSlip {
  rgb: Raster;
  grey: Raster;
  /** Maps the unit square (slip-normalised) to image pixels. */
  toImage: Mat3;
}

export const RECTIFIED_WIDTH = 1000;

/** Warps one slip to an upright raster `RECTIFIED_WIDTH` wide, keeping its drawn aspect ratio. */
export function rectify(rgb: Raster, quad: Quad, width = RECTIFIED_WIDTH): RectifiedSlip {
  const size = quadSize(quad);
  const height = Math.round((width * size.height) / size.width);
  const toImage = homography(UNIT_SQUARE, quad);
  const out = warp(rgb, toImage, width, height);
  return { rgb: out, grey: toGrey(out), toImage };
}

// ---------------------------------------------------------------------------------------------------
// Shear-tolerant ruled-line detection

/** Dark pixels as parallel coordinate arrays. */
export interface Points {
  xs: Int32Array;
  ys: Int32Array;
  n: number;
}

export function darkPoints(grey: Raster, threshold: number, win?: Box): Points {
  const x1 = Math.max(0, Math.floor(win?.x1 ?? 0));
  const y1 = Math.max(0, Math.floor(win?.y1 ?? 0));
  const x2 = Math.min(grey.width, Math.ceil(win?.x2 ?? grey.width));
  const y2 = Math.min(grey.height, Math.ceil(win?.y2 ?? grey.height));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      if ((grey.data[y * grey.width + x] as number) < threshold) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { xs: Int32Array.from(xs), ys: Int32Array.from(ys), n: xs.length };
}

export function filterPoints(p: Points, keep: (x: number, y: number) => boolean): Points {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < p.n; i++) {
    const x = p.xs[i] as number;
    const y = p.ys[i] as number;
    if (keep(x, y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs: Int32Array.from(xs), ys: Int32Array.from(ys), n: xs.length };
}

export interface LineFamily {
  /** Shear as a tangent: horizontal lines are y = pos + x·t; vertical lines are x = pos + y·t. */
  t: number;
  /** Line positions (y at x = 0, or x at y = 0), in rectified pixels. */
  positions: number[];
  profile: Float64Array;
  offset: number;
}

/**
 * Projects points along a family of near-horizontal ("h") or near-vertical ("v") lines and returns the
 * shear within ±maxDeg whose projection is sharpest (largest sum of squares), with the line positions
 * whose projected count reaches `minCount`.
 */
export function findLines(
  p: Points,
  axis: "h" | "v",
  extent: { width: number; height: number },
  minCount: number,
  opts: { maxDeg?: number; stepDeg?: number; t?: number } = {},
): LineFamily {
  const maxDeg = opts.maxDeg ?? 4;
  const step = opts.stepDeg ?? 0.1;
  const along = axis === "h" ? extent.height : extent.width;
  const across = axis === "h" ? extent.width : extent.height;
  const offset = Math.ceil(across * Math.tan((maxDeg * Math.PI) / 180)) + 2;
  const size = along + 2 * offset;
  const project = (t: number) => {
    const prof = new Float64Array(size);
    for (let i = 0; i < p.n; i++) {
      const x = p.xs[i] as number;
      const y = p.ys[i] as number;
      const pos = axis === "h" ? y - x * t : x - y * t;
      const b = Math.round(pos) + offset;
      if (b >= 0 && b < size) prof[b] = (prof[b] as number) + 1;
    }
    return prof;
  };
  let bestT = opts.t ?? 0;
  if (opts.t === undefined) {
    let bestScore = -1;
    for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
      const t = Math.tan((deg * Math.PI) / 180);
      const prof = project(t);
      let score = 0;
      for (const v of prof) score += v * v;
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
      }
    }
  }
  // Coverage, not raw counts: for each bin, how many positions along the line have ink within ±1 bin.
  // A 2 px rule that straddles two bins, or a faint anti-aliased rule, still counts as one full line.
  const occ = new Uint8Array(size * across);
  for (let i = 0; i < p.n; i++) {
    const x = p.xs[i] as number;
    const y = p.ys[i] as number;
    const pos = axis === "h" ? y - x * bestT : x - y * bestT;
    const b = Math.round(pos) + offset;
    const a = axis === "h" ? x : y;
    if (b >= 0 && b < size && a >= 0 && a < across) occ[b * across + a] = 1;
  }
  const coverage = new Float64Array(size);
  for (let b = 1; b < size - 1; b++) {
    let n = 0;
    const r0 = (b - 1) * across;
    const r1 = b * across;
    const r2 = (b + 1) * across;
    for (let a = 0; a < across; a++) if (occ[r0 + a] || occ[r1 + a] || occ[r2 + a]) n++;
    coverage[b] = n;
  }
  return {
    t: bestT,
    positions: peaks(coverage, minCount, 3).map((x) => x - offset),
    profile: coverage,
    offset,
  };
}

/** Red printed ink (the pre-printed serial). */
export const isRedInk = (r: number, g: number, b: number): boolean => r > 120 && r - g > 80 && r - b > 60;

/**
 * Green ink: slip 0449's margin note is written in a dark green felt-tip so it can be told apart from the
 * clerk's blue ballpoint (B dominant), the red serial (R dominant), black print and the brownish stain.
 */
export const isGreenInk = (r: number, g: number, b: number): boolean => g > 50 && g - r > 25 && g - b > 8;

/** Bounding box of red printed ink (the serial) inside a window, or null. */
export function findRedInk(
  rgb: Raster,
  win: Box,
  keep: (x: number, y: number) => boolean = () => true,
): Box | null {
  return findInk(rgb, win, isRedInk, keep);
}

/** Bounding box (1st–99th percentile extent, padded) of pixels whose colour passes `isInk`, or null. */
export function findInk(
  rgb: Raster,
  win: Box,
  isInk: (r: number, g: number, b: number) => boolean,
  keep: (x: number, y: number) => boolean = () => true,
  minPixels = 25,
): Box | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = Math.max(0, win.y1); y < Math.min(rgb.height, win.y2); y++) {
    for (let x = Math.max(0, win.x1); x < Math.min(rgb.width, win.x2); x++) {
      const j = (y * rgb.width + x) * 3;
      const r = rgb.data[j] as number;
      const g = rgb.data[j + 1] as number;
      const b = rgb.data[j + 2] as number;
      if (isInk(r, g, b) && keep(x, y)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < minPixels) return null;
  // Trim stray pixels: keep the 1st–99th percentile extent.
  const q = (a: number[], p: number) =>
    [...a].sort((u, v) => u - v)[Math.floor(p * (a.length - 1))] as number;
  return { x1: q(xs, 0.01) - 4, y1: q(ys, 0.01) - 4, x2: q(xs, 0.99) + 4, y2: q(ys, 0.99) + 4 };
}

/** Maps points in rectified pixels back to an axis-aligned rectangle in image pixels. */
export function pointsToImage(slip: RectifiedSlip, pts: readonly Pt[]): Box {
  const img = pts.map(([x, y]) => apply(slip.toImage, [x / slip.grey.width, y / slip.grey.height]));
  return {
    x1: Math.min(...img.map((p) => p[0])),
    y1: Math.min(...img.map((p) => p[1])),
    x2: Math.max(...img.map((p) => p[0])),
    y2: Math.max(...img.map((p) => p[1])),
  };
}

export function rectToImage(slip: RectifiedSlip, r: Box): Box {
  return pointsToImage(slip, [
    [r.x1, r.y1],
    [r.x2, r.y1],
    [r.x2, r.y2],
    [r.x1, r.y2],
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Typed pages

export interface TextBlock {
  box: Box;
  lines: Box[];
}

/** Groups dark text into lines and lines into blocks (a flat scan; no rectification needed). */
export function detectTextBlocks(rgb: Raster, opts: { gapFactor?: number } = {}): TextBlock[] {
  const grey = toGrey(rgb);
  const W = grey.width;
  const H = grey.height;
  const thr = Math.min(150, Math.round(quantile(grey, 0.6) * 0.65));
  const margin = Math.round(W * 0.02);
  const pts = darkPoints(grey, thr, { x1: margin, y1: margin, x2: W - margin, y2: H - margin });
  const rows = new Uint32Array(H);
  for (let i = 0; i < pts.n; i++) rows[pts.ys[i] as number] = (rows[pts.ys[i] as number] as number) + 1;
  const runs: { a: number; b: number }[] = [];
  for (let y = 0; y < H; y++) {
    if ((rows[y] as number) < 2) continue;
    const last = runs[runs.length - 1];
    if (last && y - last.b <= 2) last.b = y;
    else runs.push({ a: y, b: y });
  }
  const lineBoxes: Box[] = runs
    .filter((r) => r.b - r.a >= 4)
    .map((r) => {
      let x1 = W;
      let x2 = 0;
      for (let i = 0; i < pts.n; i++) {
        const y = pts.ys[i] as number;
        if (y < r.a || y > r.b) continue;
        const x = pts.xs[i] as number;
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
      }
      return { x1, y1: r.a, x2, y2: r.b };
    });
  const lh = lineBoxes.length ? median(lineBoxes.map((b) => b.y2 - b.y1)) : 10;
  const gapMax = lh * (opts.gapFactor ?? 0.9);
  const blocks: TextBlock[] = [];
  for (const lb of lineBoxes) {
    const last = blocks[blocks.length - 1];
    const prev = last?.lines[last.lines.length - 1];
    if (last && prev && lb.y1 - prev.y2 <= gapMax) {
      last.lines.push(lb);
      last.box = {
        x1: Math.min(last.box.x1, lb.x1),
        y1: last.box.y1,
        x2: Math.max(last.box.x2, lb.x2),
        y2: lb.y2,
      };
    } else {
      blocks.push({ box: { ...lb }, lines: [lb] });
    }
  }
  return blocks;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
