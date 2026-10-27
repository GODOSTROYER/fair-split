import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { sha256 } from "../util/hash.js";

export interface ImageExpectation {
  orientation: "portrait" | "landscape" | "any";
  /** Long edge in pixels; S4.10 requires at least 1,024. */
  minLongEdge: number;
  /** Long/short edge ratio bounds. Codex's built-in image_gen mostly returns 4:3, but also near-square frames (1.09 seen on 22 Oct), which are still usable. */
  aspect?: { min: number; max: number };
  /** Exact pixel size, when it is known in advance (for example an edit that must keep its input's size). */
  exact?: { width: number; height: number };
}

export const DEFAULT_EXPECTATION: Omit<ImageExpectation, "orientation"> = {
  minLongEdge: 1024,
  aspect: { min: 1.0, max: 2.0 },
};

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  bytes: number;
  sha256: string;
}

export type VerifyResult = { ok: true; info: ImageInfo } | { ok: false; reason: string; info?: ImageInfo };

/**
 * Accepts an output only when the file exists, decodes, has the expected orientation and size, and is
 * not byte-identical to an earlier attempt (S4.10 "Accepting the output").
 */
export async function verifyImage(
  path: string,
  expect: ImageExpectation,
  priorSha256: ReadonlySet<string> = new Set(),
): Promise<VerifyResult> {
  let buf: Buffer;
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size === 0) return { ok: false, reason: `not a non-empty file: ${path}` };
    buf = await readFile(path);
  } catch {
    return { ok: false, reason: `missing output file: ${path}` };
  }
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(buf).metadata();
  } catch (e) {
    return { ok: false, reason: `does not decode as an image: ${(e as Error).message}` };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const info: ImageInfo = {
    width,
    height,
    format: meta.format ?? "unknown",
    bytes: buf.length,
    sha256: sha256(buf),
  };
  if (!width || !height) return { ok: false, reason: "image has no dimensions", info };
  if (expect.exact && (width !== expect.exact.width || height !== expect.exact.height)) {
    return {
      ok: false,
      reason: `expected ${expect.exact.width}x${expect.exact.height}, got ${width}x${height}`,
      info,
    };
  }
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long < expect.minLongEdge) {
    return { ok: false, reason: `long edge ${long}px is below ${expect.minLongEdge}px`, info };
  }
  if (expect.orientation === "portrait" && width >= height) {
    return { ok: false, reason: `expected portrait, got ${width}x${height}`, info };
  }
  if (expect.orientation === "landscape" && height >= width) {
    return { ok: false, reason: `expected landscape, got ${width}x${height}`, info };
  }
  if (expect.aspect) {
    const ratio = long / short;
    if (ratio < expect.aspect.min || ratio > expect.aspect.max) {
      return {
        ok: false,
        reason: `aspect ${ratio.toFixed(2)} outside ${expect.aspect.min}–${expect.aspect.max}`,
        info,
      };
    }
  }
  if (priorSha256.has(info.sha256)) return { ok: false, reason: "identical to an earlier attempt", info };
  return { ok: true, info };
}

export interface DerivedFile {
  file: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}

/** The committed master: native size, JPEG quality 92, metadata stripped (S4.10). */
export async function writeMaster(input: string | Buffer, out: string): Promise<DerivedFile> {
  await mkdir(dirname(out), { recursive: true });
  const buf = await sharp(input)
    .rotate()
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  await writeFile(out, buf.data);
  return {
    file: out,
    sha256: sha256(buf.data),
    width: buf.info.width,
    height: buf.info.height,
    bytes: buf.data.length,
  };
}

/** The display WebP: long edge 1,600 px (or native if smaller) and at most `maxBytes` (IC-11, S4.10). */
export async function writeDisplay(
  input: string | Buffer,
  out: string,
  opts: { longEdge?: number; maxBytes?: number } = {},
): Promise<DerivedFile> {
  const longEdge = opts.longEdge ?? 1600;
  const maxBytes = opts.maxBytes ?? 250_000;
  await mkdir(dirname(out), { recursive: true });
  const meta = await sharp(input).metadata();
  const landscape = (meta.width ?? 0) >= (meta.height ?? 0);
  let target = Math.min(longEdge, Math.max(meta.width ?? 0, meta.height ?? 0));
  // Lower the quality first (84 → 48); if a busy image is still too large, shrink it by 15% and retry.
  for (let round = 0; round < 6; round++) {
    const resize = landscape
      ? { width: target, withoutEnlargement: true }
      : { height: target, withoutEnlargement: true };
    for (let quality = 84; quality >= 48; quality -= 6) {
      const r = await sharp(input)
        .rotate()
        .resize(resize)
        .webp({ quality, effort: 5 })
        .toBuffer({ resolveWithObject: true });
      if (r.data.length <= maxBytes) {
        await writeFile(out, r.data);
        return {
          file: out,
          sha256: sha256(r.data),
          width: r.info.width,
          height: r.info.height,
          bytes: r.data.length,
        };
      }
    }
    target = Math.round(target * 0.85);
  }
  throw new Error(`display WebP stays above ${maxBytes} B even at ${target}px`);
}
