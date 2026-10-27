/**
 * Sample slips (S1.9 M-CK-01 P0; S3.9 "In Judge Mode, clerk capture accepts only the sample slips"). Each one is a
 * drawn A6 weigh slip in the co-op's printed form, filled in Jessie's blue ballpoint capitals and marked
 * "Synthetic sample", filed through the same outbox as a phone capture. They belong to the next pay run (serials
 * after 0563, April 2027 deliveries), so none of them is a figure from Season 2026-A, and their kilos are derived
 * from the serial rather than written down anywhere.
 *
 * Deterministic: the same serial always draws the same bytes, so filing a sample twice shows "Already sent".
 * Pure (tested in Node).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { format } from "../../_shims/domain";
import { coop, people } from "../../_shims/seed";
import { adlaw } from "../../_shims/tokens.native";

/** A drawn, labelled stand-in for a photo: the exact bytes filed, their hash, and a durable data URI. */
export interface SampleImage {
  /** Names the file on a phone ("0564", "nadawat-M-053"). */
  key: string;
  svg: string;
  bytes: Uint8Array;
  sha256: string;
  mime: "image/svg+xml";
  width: number;
  height: number;
  /** A durable data URI for display and upload on the web. */
  dataUri: string;
}

export interface SampleSlip extends SampleImage {
  serial: string;
  memberNo: string;
  /** Delivery date as Jessie writes it (DD-MM-YYYY). */
  date: string;
  netGrams: number;
  tareGrams: number;
  grade: 1 | 2;
}

function image(key: string, svg: string, width: number, height: number): SampleImage {
  const bytes = utf8ToBytes(svg);
  return {
    key,
    svg,
    bytes,
    sha256: bytesToHex(sha256(bytes)),
    mime: "image/svg+xml",
    width,
    height,
    dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}

const SOURCE: readonly { serial: string; memberNo: string; date: string }[] = [
  { serial: "0564", memberNo: "M-014", date: "02-04-2027" },
  { serial: "0565", memberNo: "M-053", date: "02-04-2027" },
  { serial: "0566", memberNo: "M-002", date: "03-04-2027" },
];

export const SAMPLE_SERIALS: readonly string[] = SOURCE.map((s) => s.serial);

/** Width and height of the drawing: an A6 sheet (105 × 148 mm) at 4 px per mm. */
export const SAMPLE_SIZE = { width: 420, height: 592 } as const;

/** A number in [0, span) from the serial, so the drawn kilos are computed, not written down. */
function derive(serial: string, salt: string, span: number): number {
  const h = sha256(utf8ToBytes(`fair-split-sample:${salt}:${serial}`));
  return (((h[0] ?? 0) << 16) | ((h[1] ?? 0) << 8) | (h[2] ?? 0)) % span;
}

const kgFigure = (grams: number) => format.kg(grams, 2).replace(/ kg$/, "");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function draw(
  s: { serial: string; memberNo: string; date: string },
  netGrams: number,
  tareGrams: number,
  grade: 1 | 2,
) {
  const c = adlaw.color;
  const { width: W, height: H } = SAMPLE_SIZE;
  const printed = 'font-family="Arial, Helvetica, sans-serif"';
  const hand =
    'font-family="Segoe Print, Bradley Hand, Noteworthy, cursive" font-size="27" letter-spacing="1"';
  const rows: [string, string][] = [
    ["Petsa / Date", s.date],
    ["Miyembro / Member", s.memberNo],
    ["Gross kg", kgFigure(netGrams + tareGrams)],
    ["Tare kg", kgFigure(tareGrams)],
    ["Net kg", kgFigure(netGrams)],
    ["Grado / Grade", String(grade)],
    ["Clerk", people.clerk.initials],
  ];
  const top = 168;
  const gap = 52;
  const lines = rows
    .map(([label, value], i) => {
      const y = top + i * gap;
      // Ballpoint capitals sit a little crooked on the rule, as a person writes them.
      const tilt = ((derive(s.serial, `tilt${i}`, 5) - 2) * 0.6).toFixed(1);
      return [
        `<text x="34" y="${y}" ${printed} font-size="14" fill="${c.ink3}">${esc(label)}</text>`,
        `<line x1="186" y1="${y + 6}" x2="388" y2="${y + 6}" stroke="${c.rule}" stroke-width="1.2"/>`,
        `<text x="194" y="${y}" ${hand} fill="${c.ballpoint}" transform="rotate(${tilt} 194 ${y})">${esc(value.toUpperCase())}</text>`,
      ].join("");
    })
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${c.copyWhite}"/>`,
    `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="${c.hatch}" stroke-width="1.5"/>`,
    `<text x="34" y="58" ${printed} font-size="17" font-weight="700" fill="${c.ink2}">${esc(coop.name)}</text>`,
    `<text x="34" y="80" ${printed} font-size="13" fill="${c.ink3}">${esc(coop.place)}</text>`,
    `<text x="34" y="112" ${printed} font-size="15" fill="${c.ink2}">Resibo sa timbang / Weigh slip</text>`,
    `<text x="${W - 34}" y="58" text-anchor="end" ${printed} font-size="20" font-weight="700" fill="${c.red}">No. ${s.serial}</text>`,
    `<line x1="34" y1="128" x2="${W - 34}" y2="128" stroke="${c.hatch}" stroke-width="1.5"/>`,
    lines,
    `<text x="${W - 34}" y="${H - 34}" text-anchor="end" ${printed} font-size="13" fill="${c.ink3}">Synthetic sample</text>`,
    "</svg>",
  ].join("");
}

const cache = new Map<string, SampleSlip>();

export function sampleSlip(serial: string): SampleSlip {
  const hit = cache.get(serial);
  if (hit) return hit;
  const s = SOURCE.find((x) => x.serial === serial);
  if (!s) throw new RangeError(`No sample slip ${serial}`);
  const netGrams = 15_000 + derive(serial, "net", 4000) * 10;
  const tareGrams = 1_200 + derive(serial, "tare", 90) * 10;
  const grade: 1 | 2 = derive(serial, "grade", 3) === 0 ? 2 : 1;
  const slip: SampleSlip = {
    ...image(serial, draw(s, netGrams, tareGrams, grade), SAMPLE_SIZE.width, SAMPLE_SIZE.height),
    ...s,
    netGrams,
    tareGrams,
    grade,
  };
  cache.set(serial, slip);
  return slip;
}

/** The sample a capture's bytes came from, if any (the demo reader reads samples back by their serial). */
export function sampleBySha(sha: string): SampleSlip | null {
  for (const serial of SAMPLE_SERIALS) {
    const s = sampleSlip(serial);
    if (s.sha256 === sha) return s;
  }
  return null;
}

/** The first sample slip not filed yet on this phone; when all are, the first again (which reads "Already sent"). */
export function nextSampleSerial(records: readonly { sha256: string }[]): string {
  const filed = new Set(records.map((r) => r.sha256));
  return SAMPLE_SERIALS.find((s) => !filed.has(sampleSlip(s).sha256)) ?? (SAMPLE_SERIALS[0] as string);
}

/* ------------------------------------------------------------------ a sample "Nadawat" photo (cash day) */

export const NADAWAT_SIZE = { width: 360, height: 252 } as const;

/**
 * A drawn photo of a signed "Nadawat" box for one cash line, for demo and Judge Mode, where nobody holds a printed
 * statement: the strip of the 80 mm print with the member, the exact pesos at the run's rate, the box with a
 * ballpoint signature, and the witness line. Labelled "Synthetic sample"; different for every line.
 */
export function sampleNadawat(
  line: { memberNo: string; name: string; cents: number },
  phpPerUsd: string,
): SampleImage {
  const c = adlaw.color;
  const { width: W, height: H } = NADAWAT_SIZE;
  const printed = 'font-family="Arial, Helvetica, sans-serif"';
  const seed = (salt: string, span: number) => derive(line.memberNo, `nadawat:${salt}`, span);
  // A signature: one continuous ballpoint stroke whose loops come from the member number.
  let d = `M ${60 + seed("x", 20)} ${172 - seed("y", 10)}`;
  for (let i = 0; i < 6; i++) {
    const x = 92 + i * 34;
    d += ` c ${8 + seed(`a${i}`, 14)} ${-(18 + seed(`b${i}`, 22))}, ${18 + seed(`c${i}`, 12)} ${10 + seed(`d${i}`, 14)}, ${x - (60 + i * 34) + seed(`e${i}`, 8)} ${-(seed(`f${i}`, 12) - 6)}`;
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${c.copyWhite}"/>`,
    `<text x="20" y="30" ${printed} font-size="12" fill="${c.ink3}">${esc(coop.name)}</text>`,
    `<text x="20" y="54" ${printed} font-size="16" font-weight="700" fill="${c.ink}">${esc(line.name)}, ${esc(line.memberNo)}</text>`,
    `<text x="20" y="78" ${printed} font-size="15" fill="${c.ink}">Cash: ${esc(format.cashPesos(line.cents, phpPerUsd))}</text>`,
    `<rect x="20" y="96" width="${W - 40}" height="104" fill="none" stroke="${c.ink}" stroke-width="1.5"/>`,
    `<text x="30" y="116" ${printed} font-size="12" fill="${c.ink2}">Nadawat</text>`,
    `<path d="${d}" fill="none" stroke="${c.ballpoint}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="20" y="226" ${printed} font-size="12" fill="${c.ink3}">Saksi / Witness</text>`,
    `<line x1="112" y1="228" x2="210" y2="228" stroke="${c.rule}" stroke-width="1.2"/>`,
    `<text x="124" y="224" font-family="Segoe Print, Bradley Hand, Noteworthy, cursive" font-size="16" fill="${c.ballpoint}">${esc(people.clerk.initials)}</text>`,
    `<text x="${W - 20}" y="${H - 12}" text-anchor="end" ${printed} font-size="11" fill="${c.ink3}">Synthetic sample</text>`,
    "</svg>",
  ].join("");
  return image(`nadawat-${line.memberNo}`, svg, W, H);
}
