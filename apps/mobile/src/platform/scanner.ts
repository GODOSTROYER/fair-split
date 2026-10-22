/**
 * Clerk capture (M-CL-01, spike S7). The system document scanner is `CameraView.scanDocumentAsync()` in
 * expo-camera 58 (ML Kit document scanner on Android, which needs Google Play services; VisionKit on iOS). It returns
 * null on cancel or when unavailable. Pages are written to the cache, so each is resized to 1,600 px on its long
 * edge, moved into the app's documents, hashed and handed to the outbox (S1.8).
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { CameraView } from "expo-camera";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { CaptureSource } from "../lib/outbox";
import { randomBytes } from "./random";

export const MAX_EDGE = 1600;

export interface ProcessedPage {
  uri: string;
  thumbUri: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  source: CaptureSource;
  tooDark: boolean;
}

export type ScanResult =
  | { kind: "pages"; pages: ProcessedPage[] }
  | { kind: "cancelled" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

export function documentScannerAvailable(): boolean {
  return CameraView.isDocumentScannerAvailable === true;
}

/**
 * Heuristic quality gate ("Ngitngit kaayo"): a 1,600 px JPEG of a real slip at q≈0.82 carries detail; a nearly
 * black frame compresses to almost nothing. Below ~0.012 bytes per pixel we ask for a rescan. The clerk can still
 * keep the page; the reading pipeline makes the final call.
 */
export function looksTooDark(bytes: number, width: number, height: number): boolean {
  const px = width * height;
  return px > 0 && bytes / px < 0.012;
}

function capturesDir(): Directory {
  const dir = new Directory(Paths.document, "captures");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function processPage(sourceUri: string, source: CaptureSource): Promise<ProcessedPage> {
  const full = await ImageManipulator.manipulate(sourceUri, {
    maxWidth: MAX_EDGE,
    maxHeight: MAX_EDGE,
  }).renderAsync();
  const saved = await full.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  const thumbRef = await ImageManipulator.manipulate(saved.uri, {
    maxWidth: 240,
    maxHeight: 240,
  }).renderAsync();
  const thumb = await thumbRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });

  const dir = capturesDir();
  const name = `${Date.now()}-${bytesToHex(randomBytes(4))}`;
  const dest = new File(dir, `${name}.jpg`);
  const thumbDest = new File(dir, `${name}-thumb.jpg`);
  new File(saved.uri).moveSync(dest);
  new File(thumb.uri).moveSync(thumbDest);
  try {
    new File(sourceUri).delete(); // the scanner's cache copy
  } catch {
    // The OS clears the cache eventually.
  }
  const sha256 = await dest.digest("SHA-256");
  const bytes = dest.size;
  return {
    uri: dest.uri,
    thumbUri: thumbDest.uri,
    mime: "image/jpeg",
    bytes,
    width: saved.width,
    height: saved.height,
    sha256: sha256.toLowerCase(),
    source,
    tooDark: looksTooDark(bytes, saved.width, saved.height),
  };
}

export async function scanWithSystemScanner(): Promise<ScanResult> {
  if (!documentScannerAvailable()) return { kind: "unavailable" };
  try {
    const res = await CameraView.scanDocumentAsync({ quality: 1 });
    if (!res || res.pages.length === 0) return { kind: "cancelled" };
    const pages: ProcessedPage[] = [];
    for (const uri of res.pages) pages.push(await processPage(uri, "scanner"));
    return { kind: "pages", pages };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export const supportsSamples = false;
export const sampleSerials: readonly string[] = [];
export async function samplePage(_serial: string): Promise<ProcessedPage> {
  throw new Error("Sample slips are a web (Judge Mode) stand-in");
}
