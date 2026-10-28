// The weigh-slip form (the A6 triplicate pad Jessie fills at the scale): where each printed box sits, what it
// is called, and which IC-01 field it carries. One geometry serves every drawing of a slip (the contact sheet,
// the reading bench, the by-hand crop), so a crop, the reading band and a flight always point at the same box.
// Units are the drawing's: 210 × 296, two per millimetre of an A6 sheet.

import type { SlipFieldName, SnapshotPhoto, SnapshotSlip } from "@fairsplit/contracts";
import type { CSSProperties } from "react";

export const SLIP_W = 210;
export const SLIP_H = 296;

export type SlipBoxId = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13";

export interface SlipBox {
  readonly id: SlipBoxId;
  readonly field: SlipFieldName;
  /** The label printed in the box, as on the pad. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Gross over net in the middle column, as on the pad: slip 0462's stain runs across both. */
export const SLIP_BOXES: readonly SlipBox[] = [
  { id: "1", field: "date", label: "Date", x: 10, y: 44, w: 60, h: 30 },
  { id: "2", field: "member_no", label: "Member no.", x: 74, y: 44, w: 62, h: 30 },
  { id: "4", field: "plot_no", label: "Plot", x: 140, y: 44, w: 60, h: 30 },
  { id: "3", field: "member_name", label: "Name", x: 10, y: 78, w: 190, h: 30 },
  { id: "5", field: "sacks", label: "Sacks", x: 10, y: 112, w: 60, h: 30 },
  { id: "6", field: "gross_kg", label: "Gross kg", x: 74, y: 112, w: 62, h: 30 },
  { id: "7", field: "tare_kg", label: "Tare kg", x: 140, y: 112, w: 60, h: 30 },
  { id: "9", field: "mc_pct", label: "MC %", x: 10, y: 146, w: 60, h: 30 },
  { id: "8", field: "net_kg", label: "Net kg", x: 74, y: 146, w: 62, h: 30 },
  { id: "10", field: "mc_less_kg", label: "MC less kg", x: 140, y: 146, w: 60, h: 30 },
  { id: "12", field: "grade", label: "Grade", x: 10, y: 180, w: 60, h: 30 },
  { id: "11", field: "payable_kg", label: "Payable kg", x: 74, y: 180, w: 126, h: 30 },
  { id: "13", field: "deductions", label: "Deductions", x: 10, y: 214, w: 190, h: 44 },
];

export function boxFor(field: SlipFieldName): SlipBox | undefined {
  return SLIP_BOXES.find((b) => b.field === field);
}

/** Cap height of Jessie's writing inside a box, and where her line starts. */
export const HAND_SIZE = 11;
export const HAND_INSET = { x: 5, y: 14 } as const;

export type CopyKind = "white" | "pink" | "yellow";

/** The paper a copy is printed on; a logbook line or an unknown sheet is drawn on white. */
const COPY_KINDS: Readonly<Record<SnapshotSlip["copy"], CopyKind>> = {
  WHITE_ORIGINAL: "white",
  PINK_DUPLICATE: "pink",
  YELLOW_TRIPLICATE: "yellow",
  LOGBOOK_LINE: "white",
  UNKNOWN: "white",
};

export function copyKind(copy: SnapshotSlip["copy"]): CopyKind {
  return COPY_KINDS[copy];
}

/** The value Jessie wrote in a box (box 13 is up to two lines). */
export function boxText(slip: SnapshotSlip, id: SlipBoxId): readonly string[] {
  const value = slip.boxes[id];
  return Array.isArray(value) ? value : [value as string];
}

/** Which characters of a box a water stain hides: slip 0462's sits on the second digit of gross and net. */
export function stainedIndex(slip: SnapshotSlip, field: SlipFieldName): number | null {
  if (!slip.artifacts.includes("WATER_STAIN")) return null;
  return field === "gross_kg" || field === "net_kg" ? 1 : null;
}

/** "6?.80": what a reader of the stained box can see, one `?` per hidden character. */
export function stainedReading(slip: SnapshotSlip, field: SlipFieldName): string | null {
  const box = boxFor(field);
  const index = stainedIndex(slip, field);
  if (!box || index === null) return null;
  const [text = ""] = boxText(slip, box.id);
  return `${text.slice(0, index)}?${text.slice(index + 1)}`;
}

/** Where the slips sit in a photo: two by two, top left first (the photo manifest's positions). */
export const POSITIONS = ["TL", "TR", "BL", "BR"] as const;
export type SlipPosition = (typeof POSITIONS)[number];

// ---------------------------------------------------------------- photos: four slips on the mat

const PAD = 14;
export const PHOTO_W = PAD * 3 + SLIP_W * 2;
export const PHOTO_H = PAD * 3 + SLIP_H * 2;

/** A place in a photo, as fractions of the photo (left, top, width, height). */
export interface Frac {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function slipFrac(position: SlipPosition): Frac {
  const col = position === "TR" || position === "BR" ? 1 : 0;
  const row = position === "BL" || position === "BR" ? 1 : 0;
  return {
    left: (PAD + col * (SLIP_W + PAD)) / PHOTO_W,
    top: (PAD + row * (SLIP_H + PAD)) / PHOTO_H,
    width: SLIP_W / PHOTO_W,
    height: SLIP_H / PHOTO_H,
  };
}

/** A box of a slip in a photo, as fractions of the photo. */
export function boxFrac(position: SlipPosition, field: SlipFieldName): Frac | null {
  const box = boxFor(field);
  if (!box) return null;
  const slip = slipFrac(position);
  return {
    left: slip.left + (box.x / SLIP_W) * slip.width,
    top: slip.top + (box.y / SLIP_H) * slip.height,
    width: (box.w / SLIP_W) * slip.width,
    height: (box.h / SLIP_H) * slip.height,
  };
}

export function fracStyle(frac: Frac): CSSProperties {
  return {
    left: `${(frac.left * 100).toFixed(3)}%`,
    top: `${(frac.top * 100).toFixed(3)}%`,
    width: `${(frac.width * 100).toFixed(3)}%`,
    height: `${(frac.height * 100).toFixed(3)}%`,
  };
}

/** A hand-placed slip never sits square: each turns a fraction of a degree, the same every time. */
export function tilt(serial: string): number {
  const n = Number.parseInt(serial, 10);
  return ((n * 37) % 13) / 10 - 0.6;
}

export interface PhotoSlip {
  readonly position: SlipPosition;
  readonly slip: SnapshotSlip;
}

/** The photo's slips in manifest order (TL, TR, BL, BR), from the snapshot. */
export function photoSlips(photo: SnapshotPhoto, slips: readonly SnapshotSlip[]): PhotoSlip[] {
  const out: PhotoSlip[] = [];
  for (const position of POSITIONS) {
    const entry = photo.slips.find((s) => s.position === position);
    if (!entry) continue;
    const slip =
      slips.find((s) => s.serial === entry.serial && s.copy === entry.copy && s.photoId === photo.photoId) ??
      slips.find((s) => s.serial === entry.serial && s.copy === entry.copy);
    if (slip) out.push({ position, slip });
  }
  return out;
}
