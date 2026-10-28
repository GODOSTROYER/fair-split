/** Plane geometry for crop fixtures: points, quads, rectangles and 3×3 homographies. Pure, no IO. */

export type Pt = readonly [number, number];
/** Corners in order top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Pt, Pt, Pt, Pt];
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const UNIT_SQUARE: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Solves A·x = b by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs((m[r] as number[])[col] as number) > Math.abs((m[pivot] as number[])[col] as number))
        pivot = r;
    }
    const pr = m[pivot] as number[];
    if (Math.abs(pr[col] as number) < 1e-12) throw new Error("degenerate quad: points are collinear");
    [m[col], m[pivot]] = [pr, m[col] as number[]];
    const p = m[col] as number[];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r] as number[];
      const f = (row[col] as number) / (p[col] as number);
      for (let c = col; c <= n; c++) row[c] = (row[c] as number) - f * (p[c] as number);
    }
  }
  return m.map((row, i) => (row[n] as number) / (row[i] as number));
}

/** The homography H with H·src[i] ∝ dst[i] for the four corner pairs. */
export function homography(src: Quad, dst: Quad): Mat3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i] as Pt;
    const [u, v] = dst[i] as Pt;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as unknown as Mat3;
}

export function apply(h: Mat3, [x, y]: Pt): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invert(h: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, i, k] = h;
  const A = e * k - f * i;
  const B = -(d * k - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error("singular homography");
  const inv = [
    A,
    -(b * k - c * i),
    b * f - c * e,
    B,
    a * k - c * g,
    -(a * f - c * d),
    C,
    -(a * i - b * g),
    a * e - b * d,
  ];
  return inv.map((v) => v / det) as unknown as Mat3;
}

/** Projects a box through a homography and returns the axis-aligned bounds of the projected quad. */
export function projectBox(h: Mat3, b: Box): Box {
  const pts = [
    apply(h, [b.x1, b.y1]),
    apply(h, [b.x2, b.y1]),
    apply(h, [b.x2, b.y2]),
    apply(h, [b.x1, b.y2]),
  ];
  return {
    x1: Math.min(...pts.map((p) => p[0])),
    y1: Math.min(...pts.map((p) => p[1])),
    x2: Math.max(...pts.map((p) => p[0])),
    y2: Math.max(...pts.map((p) => p[1])),
  };
}

export function normaliseBox(b: Box, width: number, height: number): Box {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x1: c(b.x1 / width), y1: c(b.y1 / height), x2: c(b.x2 / width), y2: c(b.y2 / height) };
}

export function roundBox(b: Box, digits = 4): Box {
  const f = 10 ** digits;
  const r = (v: number) => Math.round(v * f) / f;
  return { x1: r(b.x1), y1: r(b.y1), x2: r(b.x2), y2: r(b.y2) };
}

export function shrinkBox(b: Box, dx: number, dy: number): Box {
  return { x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 - dx, y2: b.y2 - dy };
}

export function boxCentre(b: Box): Pt {
  return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
}

export function containsPoint(b: Box, [x, y]: Pt): boolean {
  return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
}

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const area = (r: Box) => (r.x2 - r.x1) * (r.y2 - r.y1);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Mean width and height of a quad, in its own units. */
export function quadSize(q: Quad): { width: number; height: number } {
  return {
    width: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2,
    height: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2,
  };
}
