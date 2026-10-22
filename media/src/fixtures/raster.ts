import sharp from "sharp";
import { apply, type Mat3 } from "./geometry.js";

/** An 8-bit raster with 1 (grey) or 3 (RGB) interleaved channels. */
export interface Raster {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array;
}

export async function loadRgb(input: string | Buffer): Promise<Raster> {
  const { data, info } = await sharp(input)
    .rotate()
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data: new Uint8Array(data) };
}

export function toGrey(img: Raster): Raster {
  if (img.channels === 1) return img;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) {
    out[i] = Math.round(
      0.299 * (img.data[j] as number) +
        0.587 * (img.data[j + 1] as number) +
        0.114 * (img.data[j + 2] as number),
    );
  }
  return { width: img.width, height: img.height, channels: 1, data: out };
}

/** Nearest-neighbour downscale by an integer factor (enough for masks). */
export function downscale(img: Raster, factor: number): Raster {
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const c = img.channels;
  const out = new Uint8Array(w * h * c);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y * factor + (factor >> 1)) * img.width + (x * factor + (factor >> 1))) * c;
      for (let k = 0; k < c; k++) out[(y * w + x) * c + k] = img.data[src + k] as number;
    }
  }
  return { width: w, height: h, channels: c, data: out };
}

/** Value at the q-th quantile (0..1) of a grey raster. */
export function quantile(grey: Raster, q: number): number {
  const hist = new Uint32Array(256);
  for (const v of grey.data) hist[v] = (hist[v] as number) + 1;
  const target = q * grey.data.length;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v] as number;
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * Paper mask: bright pixels that are not yellow-brown. Measured on the 22 Oct masters: white slip paper
 * reads about (187, 191, 194) with R−B ≈ −7, the pink duplicate (221, 173, 185) with R−B ≈ 36, cream
 * ledger paper R−B ≈ 10, while the bamboo mat and the desk sit at R−B 63–89. Yellow triplicate paper
 * would need its own rule (it is as yellow as the mat but much brighter). Returns 1 for paper.
 */
export function paperMask(
  rgb: Raster,
  opts: { minBright?: number; maxChroma?: number; maxRedMinusBlue?: number } = {},
): Uint8Array {
  const minBright = opts.minBright ?? 150;
  const maxChroma = opts.maxChroma ?? 60;
  const maxRB = opts.maxRedMinusBlue ?? 50;
  const n = rgb.width * rgb.height;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = rgb.data[j] as number;
    const g = rgb.data[j + 1] as number;
    const b = rgb.data[j + 2] as number;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    out[i] = mx >= minBright && mx - mn <= maxChroma && r - b <= maxRB ? 1 : 0;
  }
  return out;
}

export interface Component {
  area: number;
  /** Extreme points used for corner estimation, in mask pixels. */
  minSum: [number, number];
  maxSum: [number, number];
  minDiff: [number, number];
  maxDiff: [number, number];
  bbox: { x1: number; y1: number; x2: number; y2: number };
  cx: number;
  cy: number;
}

/** 4-connected components of a binary mask, largest first. */
export function components(mask: Uint8Array, width: number, height: number, minArea = 1): Component[] {
  const label = new Int32Array(width * height).fill(-1);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || (label[start] as number) >= 0) continue;
    const id = out.length;
    const c: Component = {
      area: 0,
      minSum: [0, 0],
      maxSum: [0, 0],
      minDiff: [0, 0],
      maxDiff: [0, 0],
      bbox: { x1: width, y1: height, x2: 0, y2: 0 },
      cx: 0,
      cy: 0,
    };
    let minS = Number.POSITIVE_INFINITY;
    let maxS = Number.NEGATIVE_INFINITY;
    let minD = Number.POSITIVE_INFINITY;
    let maxD = Number.NEGATIVE_INFINITY;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p - x) / width;
      c.area++;
      c.cx += x;
      c.cy += y;
      if (x + y < minS) {
        minS = x + y;
        c.minSum = [x, y];
      }
      if (x + y > maxS) {
        maxS = x + y;
        c.maxSum = [x, y];
      }
      if (x - y < minD) {
        minD = x - y;
        c.minDiff = [x, y];
      }
      if (x - y > maxD) {
        maxD = x - y;
        c.maxDiff = [x, y];
      }
      if (x < c.bbox.x1) c.bbox.x1 = x;
      if (y < c.bbox.y1) c.bbox.y1 = y;
      if (x > c.bbox.x2) c.bbox.x2 = x;
      if (y > c.bbox.y2) c.bbox.y2 = y;
      const nb = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const q of nb) {
        if (q >= 0 && mask[q] && (label[q] as number) < 0) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    c.cx /= c.area;
    c.cy /= c.area;
    if (c.area >= minArea) out.push(c);
  }
  return out.sort((a, b) => b.area - a.area);
}

/** Morphological closing (dilate then erode) with a square kernel, to bridge text holes in a paper mask. */
export function close(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dil = morph(mask, width, height, radius, true);
  return morph(dil, width, height, radius, false);
}

export function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(mask, width, height, radius, false);
}

function morph(mask: Uint8Array, width: number, height: number, r: number, dilate: boolean): Uint8Array {
  // Separable box min/max: rows then columns.
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const pick = dilate ? Math.max : Math.min;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = dilate ? 0 : 1;
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++)
        v = pick(v, mask[y * width + k] as number);
      tmp[y * width + x] = v;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = dilate ? 0 : 1;
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++)
        v = pick(v, tmp[k * width + x] as number);
      out[y * width + x] = v;
    }
  }
  return out;
}

/**
 * Rectifies the region `h` maps the unit square onto: output pixel (u, v) samples the source at
 * h(u / width, v / height) with bilinear interpolation.
 */
export function warp(src: Raster, h: Mat3, width: number, height: number): Raster {
  const c = src.channels;
  const out = new Uint8Array(width * height * c);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const [x, y] = apply(h, [(u + 0.5) / width, (v + 0.5) / height]);
      const x0 = Math.floor(x - 0.5);
      const y0 = Math.floor(y - 0.5);
      const fx = x - 0.5 - x0;
      const fy = y - 0.5 - y0;
      for (let k = 0; k < c; k++) {
        const s = (xx: number, yy: number) => {
          const cx = Math.min(src.width - 1, Math.max(0, xx));
          const cy = Math.min(src.height - 1, Math.max(0, yy));
          return src.data[(cy * src.width + cx) * c + k] as number;
        };
        const top = s(x0, y0) * (1 - fx) + s(x0 + 1, y0) * fx;
        const bot = s(x0, y0 + 1) * (1 - fx) + s(x0 + 1, y0 + 1) * fx;
        out[(v * width + u) * c + k] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return { width, height, channels: c, data: out };
}

/** Dark-pixel counts per row and per column inside a window of a grey raster. */
export function darkProfiles(
  grey: Raster,
  threshold: number,
  win: { x1: number; y1: number; x2: number; y2: number } = { x1: 0, y1: 0, x2: grey.width, y2: grey.height },
): { rows: Uint32Array; cols: Uint32Array } {
  const rows = new Uint32Array(grey.height);
  const cols = new Uint32Array(grey.width);
  for (let y = Math.max(0, win.y1); y < Math.min(grey.height, win.y2); y++) {
    for (let x = Math.max(0, win.x1); x < Math.min(grey.width, win.x2); x++) {
      if ((grey.data[y * grey.width + x] as number) < threshold) {
        rows[y] = (rows[y] as number) + 1;
        cols[x] = (cols[x] as number) + 1;
      }
    }
  }
  return { rows, cols };
}

/** Centres of runs where `profile ≥ min`, merging runs closer than `gap` pixels. */
export function peaks(profile: ArrayLike<number>, min: number, gap = 3): number[] {
  const out: { a: number; b: number }[] = [];
  for (let i = 0; i < profile.length; i++) {
    if ((profile[i] as number) < min) continue;
    const last = out[out.length - 1];
    if (last && i - last.b <= gap) last.b = i;
    else out.push({ a: i, b: i });
  }
  return out.map((r) => (r.a + r.b) / 2);
}
