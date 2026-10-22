/**
 * Web frames: the scanner becomes sample slips (architecture §16), labelled "Synthetic sample". Each sample is a
 * drawn slip (SVG) with a real sha256, filed through the same outbox as a phone capture. The samples belong to the
 * next pay run, so none of them is a figure from Season 2026-A.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ProcessedPage, ScanResult } from "./scanner";

export type { ProcessedPage, ScanResult } from "./scanner";

export const MAX_EDGE = 1600;
export const supportsSamples = true;

export function documentScannerAvailable(): boolean {
  return false;
}

export function looksTooDark(): boolean {
  return false;
}

export async function scanWithSystemScanner(): Promise<ScanResult> {
  return { kind: "unavailable" };
}

export async function processPage(): Promise<ProcessedPage> {
  throw new Error("Camera capture is native-only");
}

const SAMPLES: Readonly<Record<string, { member: string; kg: string; date: string }>> = {
  "0564": { member: "M-014", kg: "41.20", date: "02-04-2027" },
  "0565": { member: "M-053", kg: "63.75", date: "02-04-2027" },
  "0566": { member: "M-002", kg: "18.40", date: "03-04-2027" },
};

export const sampleSerials: readonly string[] = Object.keys(SAMPLES);

function slipSvg(serial: string): string {
  const s = SAMPLES[serial] ?? { member: "M-000", kg: "0.00", date: "" };
  const ink = "#1E3A8A";
  const hand = 'font-family="Segoe Print, Bradley Hand, Comic Sans MS, cursive" font-size="24"';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">',
    '<rect width="480" height="300" fill="#FFFFFF"/>',
    '<rect x="12" y="12" width="456" height="276" fill="none" stroke="#6F665E" stroke-width="1.5"/>',
    '<text x="28" y="44" font-family="sans-serif" font-size="15" fill="#4E453E">Bulawanon Kakaw Growers MPC, weigh slip</text>',
    `<text x="452" y="44" text-anchor="end" font-family="sans-serif" font-size="15" fill="#BF2A1C">No. ${serial}</text>`,
    '<g font-family="sans-serif" font-size="13" fill="#6F665E">',
    '<text x="28" y="92">Date</text><text x="28" y="138">Member</text><text x="28" y="184">Net kg</text><text x="28" y="230">Clerk</text>',
    "</g>",
    '<g stroke="#D8D4CD"><line x1="120" y1="96" x2="452" y2="96"/><line x1="120" y1="142" x2="452" y2="142"/>',
    '<line x1="120" y1="188" x2="452" y2="188"/><line x1="120" y1="234" x2="452" y2="234"/></g>',
    `<g ${hand} fill="${ink}">`,
    `<text x="128" y="90">${s.date}</text><text x="128" y="136">${s.member}</text>`,
    `<text x="128" y="182">${s.kg}</text><text x="128" y="228">JD</text>`,
    "</g>",
    '<text x="452" y="280" text-anchor="end" font-family="sans-serif" font-size="11" fill="#6F665E">Synthetic sample</text>',
    "</svg>",
  ].join("");
}

export async function samplePage(serial: string): Promise<ProcessedPage> {
  const svg = slipSvg(serial);
  const bytes = utf8ToBytes(svg);
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return {
    uri,
    thumbUri: uri,
    mime: "image/svg+xml",
    bytes: bytes.length,
    width: 480,
    height: 300,
    sha256: bytesToHex(sha256(bytes)),
    source: "sample",
    tooDark: false,
  };
}
