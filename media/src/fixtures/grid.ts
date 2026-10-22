import {
  darkPoints,
  filterPoints,
  findLines,
  findRedInk,
  type Points,
  type RectifiedSlip,
} from "./detect.js";
import type { Box, Pt } from "./geometry.js";
import { quantile } from "./raster.js";

/**
 * Ruled-grid detection that tolerates what generated photos do: a table that is not quite square to the
 * paper, keystone from the camera angle, and gently wavy paper. Every ruled line is fitted on its own
 * from two independent measurements (two vertical strips for horizontal rules, two horizontal bands for
 * vertical rules), so each line keeps its own slope. Cells are the quadrilaterals between fitted lines.
 */

/** A straight line through two points, in rectified pixels. */
export interface Line {
  a: Pt;
  b: Pt;
}

export function yAt(l: Line, x: number): number {
  const dx = l.b[0] - l.a[0];
  return dx === 0 ? l.a[1] : l.a[1] + ((x - l.a[0]) * (l.b[1] - l.a[1])) / dx;
}

export function xAt(l: Line, y: number): number {
  const dy = l.b[1] - l.a[1];
  return dy === 0 ? l.a[0] : l.a[0] + ((y - l.a[1]) * (l.b[0] - l.a[0])) / dy;
}

export function intersectLines(p: Line, q: Line): Pt {
  const [x1, y1] = p.a;
  const [x2, y2] = p.b;
  const [x3, y3] = q.a;
  const [x4, y4] = q.b;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) throw new Error("parallel lines");
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

export function shift(l: Line, dx: number, dy: number): Line {
  return { a: [l.a[0] + dx, l.a[1] + dy], b: [l.b[0] + dx, l.b[1] + dy] };
}

/** A cell bounded by two near-horizontal and two near-vertical lines. */
export interface CellLines {
  top: Line;
  bottom: Line;
  left: Line;
  right: Line;
}

/** Corners (TL, TR, BR, BL) of a cell, inset by `pad` pixels from its ruled lines. */
export function cellCorners(c: CellLines, pad = 2): [Pt, Pt, Pt, Pt] {
  const top = shift(c.top, 0, pad);
  const bottom = shift(c.bottom, 0, -pad);
  const left = shift(c.left, pad, 0);
  const right = shift(c.right, -pad, 0);
  return [
    intersectLines(top, left),
    intersectLines(top, right),
    intersectLines(bottom, right),
    intersectLines(bottom, left),
  ];
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export interface Strip {
  /** Centre x of the strip. */
  xc: number;
  /** Shear of the strip's rules (y = y0 + x·t). */
  t: number;
  /** Rule positions, as y at the strip centre. */
  ys: number[];
}

/** Horizontal rules crossing a vertical strip [x1, x2). */
export function stripRows(
  pts: Points,
  extent: { width: number; height: number },
  x1: number,
  x2: number,
  minFrac = 0.6,
): Strip {
  const inStrip = filterPoints(pts, (x) => x >= x1 && x < x2);
  const fam = findLines(inStrip, "h", extent, (x2 - x1) * minFrac);
  const xc = (x1 + x2) / 2;
  return { xc, t: fam.t, ys: fam.positions.map((p) => p + xc * fam.t) };
}

/**
 * Runs `analyse` on the rules of each candidate strip, then keeps the two successful strips farthest
 * apart whose results agree (same rules, within `agree` pixels at both ends), so each fitted line gets two
 * independent points. If no pair agrees, the single most trusted strip (the first success) is used.
 */
export function measureStrips<R>(
  pts: Points,
  extent: { width: number; height: number },
  strips: readonly (readonly [number, number])[],
  analyse: (ys: readonly number[]) => R | null,
  ends: (r: R) => readonly [number, number, number],
  minFrac = 0.6,
): { strip: Strip; res: R }[] {
  const ok: { strip: Strip; res: R }[] = [];
  for (const [f1, f2] of strips) {
    const strip = stripRows(pts, extent, extent.width * f1, extent.width * f2, minFrac);
    const res = analyse(strip.ys);
    if (res) ok.push({ strip, res });
  }
  let best: [number, number] | null = null;
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const p = ok[i] as { strip: Strip; res: R };
      const q = ok[j] as { strip: Strip; res: R };
      const [pFirst, pLast, pRow] = ends(p.res);
      const [qFirst, qLast] = ends(q.res);
      const tol = pRow * 0.5;
      if (Math.abs(pFirst - qFirst) > tol || Math.abs(pLast - qLast) > tol) continue;
      const d = Math.abs(q.strip.xc - p.strip.xc);
      const bd = best ? Math.abs((ok[best[1]]?.strip.xc as number) - (ok[best[0]]?.strip.xc as number)) : -1;
      if (d > bd) best = [i, j];
    }
  }
  if (best) return [ok[best[0]] as { strip: Strip; res: R }, ok[best[1]] as { strip: Strip; res: R }];
  return ok.slice(0, 1);
}

/** Lines through rule positions measured in one or two strips (paired by index). */
export function linesFromStrips(found: readonly { strip: Strip; ys: readonly number[] }[]): Line[] {
  const [p, q] = found;
  if (!p) return [];
  if (!q || q.ys.length !== p.ys.length) {
    return p.ys.map((y) => ({ a: [p.strip.xc, y] as Pt, b: [p.strip.xc + 100, y + 100 * p.strip.t] as Pt }));
  }
  const [left, right] = p.strip.xc <= q.strip.xc ? [p, q] : [q, p];
  return left.ys.map((y, i) => ({
    a: [left.strip.xc, y] as Pt,
    b: [right.strip.xc, right.ys[i] as number] as Pt,
  }));
}

/** Vertical rules crossing a band between two horizontal lines, as x positions on the band's centre line. */
export function bandCols(
  pts: Points,
  extent: { width: number; height: number },
  top: Line,
  bottom: Line,
  minFrac = 0.7,
): { yAtX: (x: number) => number; xs: number[]; height: number; t: number } {
  const inBand = filterPoints(pts, (x, y) => y >= yAt(top, x) && y <= yAt(bottom, x));
  const mid = (x: number) => (yAt(top, x) + yAt(bottom, x)) / 2;
  const height = median(
    [0.25, 0.5, 0.75].map((f) => yAt(bottom, extent.width * f) - yAt(top, extent.width * f)),
  );
  const fam = findLines(inBand, "v", extent, height * minFrac);
  // x = pos + y·t, evaluated where the rule crosses the band's centre line (two fixed-point steps).
  const xs = fam.positions.map((p) => {
    let x = p + mid(p) * fam.t;
    x = p + mid(x) * fam.t;
    return x;
  });
  return { yAtX: mid, xs, height, t: fam.t };
}

/** Lines through column positions measured in one or two bands (paired by index). */
function linesFromBands(
  a: { yAtX: (x: number) => number; t: number },
  xa: readonly number[] | null,
  b: { yAtX: (x: number) => number; t: number },
  xb: readonly number[] | null,
): Line[] {
  if (xa && xb && xa.length === xb.length) {
    return xa.map((x, i) => ({
      a: [x, a.yAtX(x)] as Pt,
      b: [xb[i] as number, b.yAtX(xb[i] as number)] as Pt,
    }));
  }
  const [band, xs] = xa ? [a, xa] : [b, xb as readonly number[]];
  return xs.map((x) => {
    const y = band.yAtX(x);
    return { a: [x, y] as Pt, b: [x + 100 * band.t, y + 100] as Pt };
  });
}

/**
 * The 12 equal rows plus the double-height row 13 within a list of rule positions. Printed rows are very
 * regular (within ±4% on the 22 Oct images), so a run may deviate at most `tolerance`; when several runs
 * qualify (a bold header line can look like one more rule), the most regular run wins.
 */
export function tableRows(
  ys: readonly number[],
  minRow: number,
  tolerance = 0.12,
): { rows: number[]; kaltas: number[]; s: number } | null {
  let best: { rows: number[]; kaltas: number[]; s: number; dev: number } | null = null;
  for (let i = 0; i + 12 < ys.length; i++) {
    const run = ys.slice(i, i + 13);
    const iv = run.slice(1).map((y, k) => y - (run[k] as number));
    const s = median(iv);
    if (s < minRow) continue;
    const dev = Math.max(...iv.map((d) => Math.abs(d - s) / s));
    if (dev > tolerance) continue;
    const bottom12 = run[12] as number;
    const after = ys.filter((y) => y > bottom12 + s * 0.3);
    const bottom = after.find((y) => y - bottom12 >= s * 1.6 && y - bottom12 <= s * 2.7);
    if (bottom === undefined) continue;
    if (!best || dev < best.dev)
      best = { rows: [...run, bottom], kaltas: after.filter((y) => y < bottom - s * 0.25), s, dev };
  }
  return best ? { rows: best.rows, kaltas: best.kaltas, s: best.s } : null;
}

export interface SlipGrid {
  width: number;
  height: number;
  /** 14 rules: the top of row 1, then the bottoms of rows 1–13. */
  rows: Line[];
  /** Ruled writing line(s) inside row 13's value cell, if drawn. */
  kaltas: Line[];
  /** Table left, number|label divider, label|value divider, table right. */
  cols: [Line, Line, Line, Line];
  signature: CellLines | null;
  clerk: CellLines | null;
  /** The red serial, in rectified pixels. */
  serial: Box | null;
}

/** Strips inside the value column, where only rules and handwriting live. */
const VALUE_STRIPS = [
  [0.48, 0.62],
  [0.62, 0.76],
  [0.76, 0.9],
] as const;

/**
 * Finds the slip table in a (roughly) rectified slip: rows from strips inside the value column, columns
 * from two bands of rows, then the signature and clerk boxes below and the red serial above.
 */
export function detectSlipGrid(slip: RectifiedSlip): SlipGrid {
  const { grey, rgb } = slip;
  const W = grey.width;
  const H = grey.height;
  const ext = { width: W, height: H };
  const thr = Math.min(160, Math.round(quantile(grey, 0.75) * 0.66));
  const pts = darkPoints(grey, thr, { x1: W * 0.01, y1: H * 0.005, x2: W * 0.99, y2: H * 0.995 });
  const minRow = H * 0.015;

  const strips = measureStrips(
    pts,
    ext,
    VALUE_STRIPS,
    (ys) => tableRows(ys, minRow),
    (r) => [r.rows[0] as number, r.rows[13] as number, r.s],
  );
  if (!strips.length) throw new Error("slip grid: no run of 12 equal rows in any value-column strip");
  const rows = linesFromStrips(strips.map((x) => ({ strip: x.strip, ys: x.res.rows })));
  const kaltasSame = strips.every((x) => x.res.kaltas.length === strips[0]?.res.kaltas.length);
  const kaltas = kaltasSame ? linesFromStrips(strips.map((x) => ({ strip: x.strip, ys: x.res.kaltas }))) : [];
  const s = median(strips.map((x) => x.res.s));

  // Columns from two bands of rows (rows 2–5 and rows 8–11).
  const bandA = bandCols(pts, ext, rows[1] as Line, rows[5] as Line);
  const bandB = bandCols(pts, ext, rows[7] as Line, rows[11] as Line);
  const pick = (xs: readonly number[]) => {
    if (xs.length < 4) return null;
    const left = xs[0] as number;
    const right = xs[xs.length - 1] as number;
    const inner = xs.slice(1, -1);
    const near = (f: number) => {
      const target = left + (right - left) * f;
      return inner.reduce(
        (best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best),
        inner[0] as number,
      );
    };
    const numLabel = near(0.08);
    const labelValue = near(0.38);
    return numLabel < labelValue ? [left, numLabel, labelValue, right] : null;
  };
  const ca = pick(bandA.xs);
  const cb = pick(bandB.xs);
  if (!ca && !cb)
    throw new Error(
      `slip grid: column rules not found (bands saw ${bandA.xs.length} and ${bandB.xs.length})`,
    );
  const cols = linesFromBands(bandA, ca, bandB, cb) as [Line, Line, Line, Line];

  // Signature and clerk boxes: the first two rules below the table, then the four box sides between them.
  let signature: CellLines | null = null;
  let clerk: CellLines | null = null;
  const tableBottom = rows[13] as Line;
  const boxRules = strips
    .map(({ strip }) => {
      const below = strip.ys.filter((y) => y > yAt(tableBottom, strip.xc) + s * 0.15);
      const top = below[0];
      const bottom = top === undefined ? undefined : below.find((y) => y - top > s * 1.2);
      return top !== undefined && bottom !== undefined ? { strip, ys: [top, bottom] } : null;
    })
    .filter((x) => x !== null);
  const boxLines = linesFromStrips(boxRules);
  const boxTop = boxLines[0];
  const boxBottom = boxLines[1];
  if (boxTop && boxBottom) {
    const sides = bandCols(pts, ext, boxTop, boxBottom, 0.65);
    if (sides.xs.length >= 4) {
      const xs = sides.xs;
      // Side by side: the narrowest interior gap separates the signature box from the clerk box.
      let gapAt = 1;
      for (let k = 1; k < xs.length - 2; k++) {
        if ((xs[k + 1] as number) - (xs[k] as number) < (xs[gapAt + 1] as number) - (xs[gapAt] as number))
          gapAt = k;
      }
      const vline = (x: number): Line => {
        const y = sides.yAtX(x);
        return { a: [x, y], b: [x + 100 * sides.t, y + 100] };
      };
      const first: CellLines = {
        top: boxTop,
        bottom: boxBottom,
        left: vline(xs[0] as number),
        right: vline(xs[gapAt] as number),
      };
      const second: CellLines = {
        top: boxTop,
        bottom: boxBottom,
        left: vline(xs[gapAt + 1] as number),
        right: vline(xs[xs.length - 1] as number),
      };
      const width = (c: CellLines) => c.right.a[0] - c.left.a[0];
      [signature, clerk] = width(first) >= width(second) ? [first, second] : [second, first];
    }
  }

  // The red serial sits above the table; keep only red ink above the table's top rule.
  const tableTop = rows[0] as Line;
  const serial = findRedInk(
    rgb,
    { x1: 0, y1: 0, x2: W, y2: Math.max(1, Math.round(Math.max(yAt(tableTop, 0), yAt(tableTop, W)))) },
    (x, y) => y < yAt(tableTop, x) - 1,
  );
  return { width: W, height: H, rows, kaltas, cols, signature, clerk, serial };
}

export interface LedgerGrid {
  width: number;
  height: number;
  /** Rules from the top of line 1 through the bottom of the last line. */
  rows: Line[];
  /** Column rules, left to right. */
  cols: Line[];
}

const LEDGER_STRIPS = [
  [0.14, 0.24],
  [0.24, 0.34],
  [0.42, 0.56],
  [0.62, 0.72],
  [0.8, 0.92],
] as const;

/** Ruled ledger grid: `lines` equal rows (anchored at the bottom of the table) and `columns` columns. */
export function detectLedgerGrid(page: RectifiedSlip, lines: number, columns: number): LedgerGrid {
  const { grey } = page;
  const W = grey.width;
  const H = grey.height;
  const ext = { width: W, height: H };
  const thr = Math.min(190, Math.round(quantile(grey, 0.7) * 0.88));
  const pts = darkPoints(grey, thr, { x1: W * 0.01, y1: H * 0.005, x2: W * 0.99, y2: H * 0.995 });
  const runOf = (ys: readonly number[]) => {
    for (let i = ys.length - lines - 1; i >= 0; i--) {
      const run = ys.slice(i, i + lines + 1);
      const iv = run.slice(1).map((y, k) => y - (run[k] as number));
      const s = median(iv);
      if (s > H * 0.015 && iv.every((d) => Math.abs(d - s) <= s * 0.2)) return run;
    }
    return null;
  };
  const strips = measureStrips(
    pts,
    ext,
    LEDGER_STRIPS,
    runOf,
    (r) => [
      r[0] as number,
      r[r.length - 1] as number,
      ((r[r.length - 1] as number) - (r[0] as number)) / lines,
    ],
    0.5,
  );
  if (!strips.length) throw new Error(`ledger grid: no run of ${lines} equal rows in any strip`);
  const rows = linesFromStrips(strips.map((x) => ({ strip: x.strip, ys: x.res })));
  const top = Math.floor(lines * 0.15);
  const mid = Math.floor(lines * 0.55);
  const bandA = bandCols(pts, ext, rows[top] as Line, rows[top + 3] as Line, 0.75);
  const bandB = bandCols(pts, ext, rows[mid] as Line, rows[mid + 3] as Line, 0.75);
  const choose = (xs: readonly number[]) => (xs.length === columns + 1 ? xs : null);
  const ca = choose(bandA.xs);
  const cb = choose(bandB.xs);
  if (!ca && !cb) {
    throw new Error(
      `ledger grid: expected ${columns + 1} column rules, bands saw ${bandA.xs.length} and ${bandB.xs.length}`,
    );
  }
  return { width: W, height: H, rows, cols: linesFromBands(bandA, ca, bandB, cb) };
}
