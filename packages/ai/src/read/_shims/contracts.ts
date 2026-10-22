// TEMPORARY SHIM: replace with @fairsplit/contracts after WS-CORE merges.
// Mirrors the IC-01 names and shapes WS-READ consumes: the reading RunEvents (register §11,
// S4.11 contract asks), hold kinds and gates (register §7), fixtures (IC-11).
import type { Box, CopyColour, RowField } from "../schema.js";

export type HoldKind =
  | "DUPLICATE_SLIP"
  | "IMPLAUSIBLE_YIELD"
  | "NO_RULE"
  | "RATE_MISMATCH"
  | "SUSPECTED_INJECTION"
  | "LOW_CONFIDENCE"
  | "MASS_BALANCE";
export type HoldGate = "BLOCKS_APPROVAL" | "RESERVES_LINE";
export type DecidedBy = "agreement" | "zoom" | "person";

/** `extract.field {docId, row, field, variant, box}`: a completed field, with no value. */
export interface ExtractFieldEvent {
  type: "extract.field";
  docId: string;
  row: number;
  field: RowField | "deductions";
  variant: "A" | "B";
  box: Box;
}

/** `extract.row {docId, row, serial, memberNo, fields: {[name]: {value, score, decidedBy, display}}}`. */
export interface ExtractRowEvent {
  type: "extract.row";
  docId: string;
  row: number;
  serial: string;
  memberNo: string;
  fields: Record<string, { value: string; score: number; decidedBy: DecidedBy; display: string }>;
}

/** `extract.quarantined {docId, row | null, box | null, source}`. */
export interface ExtractQuarantinedEvent {
  type: "extract.quarantined";
  docId: string;
  row: number | null;
  box: Box | null;
  source: "screen" | "read_a" | "read_b";
}

export type ReadingEvent = ExtractFieldEvent | ExtractRowEvent | ExtractQuarantinedEvent;

/** A hold the reading stage proposes; the engine (WS-CORE) owns raising it. */
export interface HoldDraft {
  kind: HoldKind;
  gate: HoldGate;
  docId: string;
  row: number | null;
  field?: RowField | "deductions";
  reason: string;
}

/** A rectangle normalised to 0-1 of the image (IC-11 fixtures). */
export interface NormRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** IC-11 `media/fixtures/{photo}.json`: per slip its number, copy colour, and a rectangle for each field. */
export interface PhotoFixture {
  photo: string;
  slips: Array<{
    slot?: string;
    serial: string;
    copy: CopyColour;
    rect: NormRect;
    fields: Partial<Record<RowField, NormRect>>;
    deductions?: NormRect[];
  }>;
}
