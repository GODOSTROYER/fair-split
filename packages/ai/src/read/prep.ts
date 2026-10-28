import sharp from "sharp";
import { inputShaOf, sha256Hex } from "../gateway/index.js";
import { countImageTokens, HIGH_RES_MAX_EDGE, HIGH_RES_MAX_TOKENS, resizedSize } from "./resize.js";
import type { Box } from "./schema.js";

/**
 * Image preparation (S4.2 "Preprocessing", sharp 0.35.5). Bump PREP_V whenever any step changes:
 * it is part of every image call's replay identity.
 */
export const PREP_V = "prep.v1";
export type Rotation = 0 | 90 | 180 | 270;

export interface PreparedImage {
  /** sha256 of the uploaded file: the `documents.sha256` and the exact-duplicate signal. */
  documentSha256: string;
  width: number;
  height: number;
  rotation: Rotation;
  /** Variant A: the colour master, JPEG q92. Model boxes map 1:1 onto it. */
  A: Buffer;
  /** Variant B: greyscale + CLAHE + normalise, JPEG q92, same size, so the two reads fail differently. */
  B: Buffer;
  /** sha256 of the exact bytes sent, for audit. */
  sentSha: { A: string; B: string };
  /** The gateway `inputSha` (the register's imageSha slot) of each variant. */
  identity: { A: string; B: string };
  visualTokens: number;
}

/**
 * The replay identity of a derived image: the source document's sha256, the prep version and the
 * operation. sharp/libvips output is not guaranteed bit-identical across platforms and CPUs, and CI
 * replays recordings made on the dev machine, so keying on the derived bytes would miss (ADR 0003).
 */
export function imageIdentity(documentSha256: string, op: Record<string, unknown>): string {
  return inputShaOf({ doc: documentSha256, prep: PREP_V, ...op });
}

interface Raw {
  data: Buffer;
  info: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
}

async function orientedRaw(bytes: Buffer, rotation: Rotation): Promise<Raw> {
  // autoOrient applies EXIF orientation; raw output carries no metadata (GPS included).
  let out = (await sharp(bytes)
    .autoOrient()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true })) as Raw;
  if (rotation !== 0) {
    out = (await sharp(out.data, { raw: out.info })
      .rotate(rotation)
      .raw()
      .toBuffer({ resolveWithObject: true })) as Raw;
  }
  return out;
}

export async function prepareImage(
  bytes: Buffer,
  opts: { rotation?: Rotation } = {},
): Promise<PreparedImage> {
  const rotation = opts.rotation ?? 0;
  const documentSha256 = sha256Hex(bytes);
  const src = await orientedRaw(bytes, rotation);
  const [width, height] = resizedSize(
    src.info.width,
    src.info.height,
    HIGH_RES_MAX_EDGE,
    HIGH_RES_MAX_TOKENS,
  );
  const resized: Raw =
    width === src.info.width && height === src.info.height
      ? src
      : ((await sharp(src.data, { raw: src.info })
          .resize(width, height, { fit: "fill", kernel: "lanczos3" })
          .raw()
          .toBuffer({ resolveWithObject: true })) as Raw);
  const A = await sharp(resized.data, { raw: resized.info }).jpeg({ quality: 92 }).toBuffer();
  const B = await sharp(resized.data, { raw: resized.info })
    .greyscale()
    .clahe({ width: 64, height: 64, maxSlope: 3 })
    .normalise({ lower: 1, upper: 99 })
    .toColourspace("b-w")
    .jpeg({ quality: 92 })
    .toBuffer();
  return {
    documentSha256,
    width,
    height,
    rotation,
    A,
    B,
    sentSha: { A: sha256Hex(A), B: sha256Hex(B) },
    identity: {
      A: imageIdentity(documentSha256, { variant: "A", rotation }),
      B: imageIdentity(documentSha256, { variant: "B", rotation }),
    },
    visualTokens: countImageTokens(width, height),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Bump whenever the sanitiser changes what it paints: it is part of every crop's replay identity. */
export const SANITIZE_V = "sanitize.v1";
/** Everything outside the slip's reviewed rectangle (a neighbouring slip, the mat, a margin note). */
export const OUTSIDE_FILL = [128, 128, 128] as const;
/** Every quarantined box: opaque, so no stroke of the text survives. */
export const QUARANTINE_FILL = [40, 40, 40] as const;

export interface ZoomCrop {
  image: Buffer;
  /** Crop origin in master pixels. */
  origin: { x: number; y: number };
  /** Output pixels per master pixel on each axis. */
  scale: { x: number; y: number };
  width: number;
  height: number;
  /** The crop window in master pixels. */
  rect: Box;
}

/** A crop as a model may see it, with everything that decided its bytes (for the replay identity). */
export interface ModelCrop extends ZoomCrop {
  recipe: { v: typeof SANITIZE_V; slip: Box; hatch: Box[] };
}

export interface CropRequest {
  /** The reviewed rectangle to read: a field, a deduction line or a whole slip (master pixels). */
  rect: Box;
  /** The reviewed rectangle of the slip it belongs to: everything outside it is flat grey. */
  slip: Box;
  /** Quarantined boxes (master pixels), filled opaque with a margin. */
  hatch: readonly Box[];
}

/**
 * The crop window of S4.2's zoom: the rectangle padded by 25% on every side (at least 160x96 px),
 * kept inside the image, and the x2 Lanczos upscale with a long edge of at most 1,000 px.
 */
export function zoomWindow(
  size: { width: number; height: number },
  rect: Box,
): { rect: Box; width: number; height: number } {
  const W = size.width;
  const H = size.height;
  const w = Math.max(1, rect.x2 - rect.x1);
  const h = Math.max(1, rect.y2 - rect.y1);
  const cw = Math.min(W, Math.max(Math.round(w * 1.5), 160));
  const ch = Math.min(H, Math.max(Math.round(h * 1.5), 96));
  const left = clamp(Math.round((rect.x1 + rect.x2) / 2 - cw / 2), 0, W - cw);
  const top = clamp(Math.round((rect.y1 + rect.y2) / 2 - ch / 2), 0, H - ch);
  const k = Math.min(2, 1000 / Math.max(cw, ch));
  return {
    rect: { x1: left, y1: top, x2: left + cw, y2: top + ch },
    width: Math.max(1, Math.round(cw * k)),
    height: Math.max(1, Math.round(ch * k)),
  };
}

const inside = (b: Box, x: number, y: number) => x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2;

/**
 * `sanitizeForModel` (S4.2, S4.7 layer 4): the only way a crop of a document reaches a model (AI-3
 * zooms here; WS-AGENT's `get_slip_evidence`). The window comes from a reviewed rectangle (C-10,
 * never a model box) and is cut from variant A. Pixels outside the slip's reviewed rectangle become
 * flat grey; quarantined boxes, padded by 2% of the slip's width (at least 8 px), become opaque
 * fill. Hatching only ever removes pixels, so a model box may place it. Upscaled x2 with Lanczos.
 */
export async function sanitizeForModel(
  master: Buffer,
  size: { width: number; height: number },
  req: CropRequest,
): Promise<ModelCrop> {
  const win = zoomWindow(size, req.rect);
  const { x1: left, y1: top } = win.rect;
  const cw = win.rect.x2 - left;
  const ch = win.rect.y2 - top;
  const pad = Math.max(8, Math.round(0.02 * Math.max(0, req.slip.x2 - req.slip.x1)));
  const hatch = req.hatch
    .map((b) => ({
      x1: Math.max(win.rect.x1, b.x1 - pad),
      y1: Math.max(win.rect.y1, b.y1 - pad),
      x2: Math.min(win.rect.x2, b.x2 + pad),
      y2: Math.min(win.rect.y2, b.y2 + pad),
    }))
    .filter((b) => b.x2 > b.x1 && b.y2 > b.y1)
    .sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1 || a.x2 - b.x2 || a.y2 - b.y2);
  const { data } = await sharp(master)
    .extract({ left, top, width: cw, height: ch })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const X = left + x;
      const Y = top + y;
      const fill = !inside(req.slip, X, Y)
        ? OUTSIDE_FILL
        : hatch.some((b) => inside(b, X, Y))
          ? QUARANTINE_FILL
          : null;
      if (!fill) continue;
      const i = (y * cw + x) * 3;
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
    }
  }
  const image = await sharp(data, { raw: { width: cw, height: ch, channels: 3 } })
    .resize(win.width, win.height, { fit: "fill", kernel: "lanczos3" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return {
    image,
    origin: { x: left, y: top },
    scale: { x: win.width / cw, y: win.height / ch },
    width: win.width,
    height: win.height,
    rect: win.rect,
    recipe: { v: SANITIZE_V, slip: req.slip, hatch },
  };
}

/** Maps a box returned on a zoom crop back onto the master (offset by the crop origin, unscaled). */
export function cropBoxToMaster(box: Box, crop: Pick<ZoomCrop, "origin" | "scale">): Box {
  return {
    x1: Math.round(crop.origin.x + box.x1 / crop.scale.x),
    y1: Math.round(crop.origin.y + box.y1 / crop.scale.y),
    x2: Math.round(crop.origin.x + box.x2 / crop.scale.x),
    y2: Math.round(crop.origin.y + box.y2 / crop.scale.y),
  };
}

/** 64-bit difference hash of an image region, as 16 hex digits (S4.2 duplicate signal 3). */
export async function dHash64(image: Buffer, rect?: Box): Promise<string> {
  let pipeline = sharp(image);
  if (rect) {
    pipeline = pipeline.extract({
      left: Math.max(0, rect.x1),
      top: Math.max(0, rect.y1),
      width: Math.max(1, rect.x2 - rect.x1),
      height: Math.max(1, rect.y2 - rect.y1),
    });
  }
  const px = await pipeline.greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      bits = (bits << 1n) | ((px[r * 9 + c] ?? 0) > (px[r * 9 + c + 1] ?? 0) ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingHex(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
