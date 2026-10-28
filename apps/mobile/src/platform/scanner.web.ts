/**
 * Clerk capture on the web export (/app): there is no document scanner, so "Scan resibo" opens the browser's own
 * camera or file picker (expo-image-picker: the camera directly on a phone's browser, a file dialog on a laptop).
 * Each photo is resized on a canvas to 1,600 px (JPEG, q 0.82) and kept as a data URI, which, unlike the picker's
 * blob URL, survives a reload in the outbox's IndexedDB; the sha256 is over exactly the JPEG bytes uploaded.
 *
 * Judge Mode files sample slips instead (S3.9: the co-op accepts only those there), drawn and labelled
 * "Synthetic sample".
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { type SampleImage, sampleSlip } from "../features/clerk/samples";
import type { CaptureSource } from "../lib/outbox";
import type { ProcessedPage, ScanResult } from "./scanner";

export type { ProcessedPage, ScanResult } from "./scanner";

export const MAX_EDGE = 1600;
export const THUMB_EDGE = 320;
const JPEG_QUALITY = 0.82;

/** The browser's own picker is the fallback; there is no in-app camera on the web. */
export const hasCameraFallback = false;

export function documentScannerAvailable(): boolean {
  return false;
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function processPage(sourceUri: string, source: CaptureSource): Promise<ProcessedPage> {
  const full = await ImageManipulator.manipulate(sourceUri, {
    maxWidth: MAX_EDGE,
    maxHeight: MAX_EDGE,
  }).renderAsync();
  const saved = await full.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64) throw new Error("The browser did not encode the photo");
  const thumbRef = await ImageManipulator.manipulate(`data:image/jpeg;base64,${saved.base64}`, {
    maxWidth: THUMB_EDGE,
    maxHeight: THUMB_EDGE,
  }).renderAsync();
  const thumb = await thumbRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  for (const u of [saved.uri, thumb.uri]) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
  const bytes = base64Bytes(saved.base64);
  return {
    uri: `data:image/jpeg;base64,${saved.base64}`,
    thumbUri: thumb.base64
      ? `data:image/jpeg;base64,${thumb.base64}`
      : `data:image/jpeg;base64,${saved.base64}`,
    mime: "image/jpeg",
    bytes: bytes.length,
    width: saved.width,
    height: saved.height,
    sha256: bytesToHex(sha256(bytes)),
    source,
  };
}

async function processPicked(
  res: ImagePicker.ImagePickerResult,
  onProcessing?: () => void,
): Promise<ScanResult> {
  if (res.canceled || !res.assets?.length) return { kind: "cancelled" };
  onProcessing?.();
  try {
    const pages: ProcessedPage[] = [];
    for (const a of res.assets) {
      pages.push(await processPage(a.uri, "file"));
      if (a.uri.startsWith("blob:")) URL.revokeObjectURL(a.uri);
    }
    return { kind: "pages", pages };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * "Scan resibo" on the web: the browser's camera on a phone, a file dialog on a laptop. Called straight from the
 * press handler (no await before it), so the browser counts the click as the person's own.
 */
export async function scanWithSystemScanner(onProcessing?: () => void): Promise<ScanResult> {
  try {
    return await processPicked(
      await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 }),
      onProcessing,
    );
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function pickFromLibrary(onProcessing?: () => void): Promise<ScanResult> {
  try {
    return await processPicked(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 1,
      }),
      onProcessing,
    );
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export const pickFile = pickFromLibrary;

export async function sampleImagePage(img: SampleImage): Promise<ProcessedPage> {
  return {
    uri: img.dataUri,
    thumbUri: img.dataUri,
    mime: img.mime,
    bytes: img.bytes.length,
    width: img.width,
    height: img.height,
    sha256: img.sha256,
    source: "sample",
  };
}

export function samplePage(serial: string): Promise<ProcessedPage> {
  return sampleImagePage(sampleSlip(serial));
}

export function deleteCaptureFile(uri: string): void {
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}
