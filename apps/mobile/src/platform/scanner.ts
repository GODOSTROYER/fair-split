/**
 * Clerk capture on Android/iOS (M-CL-01; spike S7). The system document scanner is `CameraView.scanDocumentAsync()`
 * in expo-camera 58: ML Kit's scanner on Android (it needs Google Play services) or VisionKit on iOS. It crops,
 * de-skews and returns pages, or null on cancel or when unavailable; the screen then offers our own camera with an
 * edge guide, or a photo from the phone.
 *
 * Every page is resized to 1,600 px on its long edge (JPEG, q 0.82), given a 320 px thumbnail, moved out of the
 * cache into the app's documents (the OS never clears them), and hashed: the sha256 of exactly the bytes that will
 * be uploaded, which is also the outbox's duplicate check and the Content-Digest.
 */
import { CameraView } from "expo-camera";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { type SampleImage, sampleSlip } from "../features/clerk/samples";
import type { CaptureSource } from "../lib/outbox";
import { randomBytes } from "./random";

export const MAX_EDGE = 1600;
export const THUMB_EDGE = 320;
const JPEG_QUALITY = 0.82;

export interface ProcessedPage {
  uri: string;
  thumbUri: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  source: CaptureSource;
}

export type ScanResult =
  | { kind: "pages"; pages: ProcessedPage[] }
  | { kind: "cancelled" }
  | { kind: "unavailable" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

/** Native has a camera fallback with an edge guide (the web has the browser's own file picker instead). */
export const hasCameraFallback = true;

export function documentScannerAvailable(): boolean {
  return CameraView.isDocumentScannerAvailable === true;
}

function capturesDir(): Directory {
  const dir = new Directory(Paths.document, "captures");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileName(): string {
  const r = randomBytes(4);
  return `${Date.now()}-${Array.from(r, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Resizes, thumbnails, moves into the app's documents and hashes one page. Deletes the source cache copy. */
export async function processPage(sourceUri: string, source: CaptureSource): Promise<ProcessedPage> {
  const full = await ImageManipulator.manipulate(sourceUri, {
    maxWidth: MAX_EDGE,
    maxHeight: MAX_EDGE,
  }).renderAsync();
  const saved = await full.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  full.release();
  const thumbRef = await ImageManipulator.manipulate(saved.uri, {
    maxWidth: THUMB_EDGE,
    maxHeight: THUMB_EDGE,
  }).renderAsync();
  const thumb = await thumbRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  thumbRef.release();

  const dir = capturesDir();
  const name = fileName();
  const dest = new File(dir, `${name}.jpg`);
  const thumbDest = new File(dir, `${name}-thumb.jpg`);
  new File(saved.uri).moveSync(dest);
  new File(thumb.uri).moveSync(thumbDest);
  if (source === "scanner" || source === "camera") deleteCaptureFile(sourceUri); // the scanner's or camera's cache copy
  return {
    uri: dest.uri,
    thumbUri: thumbDest.uri,
    mime: "image/jpeg",
    bytes: dest.size ?? 0,
    width: saved.width,
    height: saved.height,
    sha256: (await dest.digest("SHA-256")).toLowerCase(),
    source,
  };
}

/** Pages in scan order; a page that cannot be prepared ends the scan with an error, never a silent gap. */
async function processAll(
  uris: readonly string[],
  source: CaptureSource,
  onProcessing?: () => void,
): Promise<ScanResult> {
  onProcessing?.();
  try {
    const pages: ProcessedPage[] = [];
    for (const uri of uris) pages.push(await processPage(uri, source));
    return { kind: "pages", pages };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** `onProcessing` fires once pages are chosen and are being prepared (the screen's "scanning" state). */
export async function scanWithSystemScanner(onProcessing?: () => void): Promise<ScanResult> {
  if (!documentScannerAvailable()) return { kind: "unavailable" };
  let res: Awaited<ReturnType<typeof CameraView.scanDocumentAsync>>;
  try {
    res = await CameraView.scanDocumentAsync({ quality: 1 });
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
  if (!res || res.pages.length === 0) return { kind: "cancelled" };
  return processAll(res.pages, "scanner", onProcessing);
}

/** A photo already on the phone (the scanner is missing, or the clerk photographed the slip earlier). */
export async function pickFromLibrary(onProcessing?: () => void): Promise<ScanResult> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 1,
      exif: false,
    });
    if (res.canceled || !res.assets?.length) return { kind: "cancelled" };
    return processAll(
      res.assets.map((a) => a.uri),
      "library",
      onProcessing,
    );
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Native has no browser file picker: the screen offers the camera fallback instead. */
export async function pickFile(_onProcessing?: () => void): Promise<ScanResult> {
  return { kind: "unavailable" };
}

/** A drawn, labelled sample written to the app's documents, so it uploads like any page (demo and Judge Mode). */
export async function sampleImagePage(img: SampleImage): Promise<ProcessedPage> {
  const dest = new File(capturesDir(), `sample-${img.key}.svg`);
  if (!dest.exists) await dest.write(img.bytes);
  return {
    uri: dest.uri,
    thumbUri: dest.uri,
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

/** Best effort: a file the OS already removed, or a non-file URI, is not an error. */
export function deleteCaptureFile(uri: string): void {
  if (!uri.startsWith("file:")) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Nothing to do: the outbox never depends on a delete.
  }
}
