// W-TR-04 By hand (S1.7, design §6 C4), pure: the one field a person must enter, its masked pattern ("6▢.80"),
// what the value means in kilos (gross − tare = net, in integer grams) and whether the logbook, the second
// witness, agrees. The preview is arithmetic on kilos, never money; the engine's answer to the entry (its
// `derived` net and `logbookMatch`) is what the run keeps (I1).

import type { SeasonSnapshot, SlipFieldName, SnapshotLogbookPage, SnapshotSlip } from "@fairsplit/contracts";
import { format } from "../../lib/format.js";

export type ByHandState = "empty" | "typing" | "match" | "mismatch" | "committed" | "skipped";

/** The square the hidden digit sits in, as typed into the mask. */
export const SLOT = "▢";

export interface LogbookWitness {
  readonly page: SnapshotLogbookPage;
  readonly lineNo: number;
  readonly netKgText: string;
}

export function logbookWitness(snapshot: SeasonSnapshot, serial: string): LogbookWitness | null {
  for (const page of snapshot.logbook) {
    const line = page.lines.find((l) => l.serial === serial);
    if (line) return { page, lineNo: line.lineNo, netKgText: line.netKgText };
  }
  return null;
}

/** Kilos as written ("64.80") to grams, or null when it is not two-decimal kilos. */
export function gramsOf(text: string): number | null {
  const m = /^(\d{1,3})\.(\d{2})$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 1000 + Number(m[2]) * 10;
}

/** The mask for a stained reading: "6?.80" → "6▢.80", with the slot's index. */
export function maskOf(reading: string): { readonly template: string; readonly slot: number } | null {
  const slot = reading.indexOf("?");
  if (slot < 0) return null;
  return { template: `${reading.slice(0, slot)}${SLOT}${reading.slice(slot + 1)}`, slot };
}

/** Fills the mask's slot with one digit. */
export function fillMask(template: string, digit: string): string {
  return template.replace(SLOT, digit);
}

/** The first digit `next` has where the template has something else: what the person just typed. */
export function insertedDigit(template: string, next: string): string | null {
  for (let i = 0; i < next.length; i++) {
    const c = next.charAt(i);
    if (c !== template.charAt(i) && /\d/.test(c)) return c;
  }
  return null;
}

/** A complete entry: kilos with two decimals. */
export function isComplete(value: string): boolean {
  return gramsOf(value) !== null;
}

export interface Preview {
  readonly gross: string;
  readonly tare: string;
  /** Gross minus tare, as the slip writes kilos. */
  readonly net: string;
  readonly matches: boolean | null;
}

/** What a typed gross means: its net after the slip's tare, and whether the logbook agrees. */
export function preview(value: string, tareText: string, witness: LogbookWitness | null): Preview | null {
  const gross = gramsOf(value);
  const tare = gramsOf(tareText);
  if (gross === null || tare === null || gross < tare) return null;
  const net = format.slipKg(gross - tare);
  return {
    gross: format.slipKg(gross),
    tare: format.slipKg(tare),
    net,
    matches: witness ? witness.netKgText === net : null,
  };
}

/** "Use logbook line 7": the gross the logbook's net implies (net + tare), as the slip would write it. */
export function grossFromLogbook(witness: LogbookWitness, tareText: string): string | null {
  const net = gramsOf(witness.netKgText);
  const tare = gramsOf(tareText);
  if (net === null || tare === null) return null;
  return format.slipKg(net + tare);
}

export interface ByHandSlip {
  readonly slip: SnapshotSlip;
  readonly field: SlipFieldName;
  /** What the reads could see: "6?.80". */
  readonly reading: string;
  /** The agreement score the reading reported for the field. */
  readonly score: number | null;
}

/** The field slip `serial` needs by hand (gross weight under 0462's stain), or null when it needs none. */
export function byHandField(snapshot: SeasonSnapshot, serial: string): ByHandSlip | null {
  const hold = snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE" && h.serials.includes(serial));
  const slip = snapshot.slips.find((s) => s.serial === serial && s.copy === "WHITE_ORIGINAL");
  if (!hold || !slip) return null;
  const stained = slip.artifacts.includes("WATER_STAIN");
  const box = slip.boxes["6"];
  const reading = stained ? `${box.charAt(0)}?${box.slice(2)}` : box;
  const checkpoint = snapshot.checkpoints.read.holds.find((h) => h.key === hold.key);
  const fields = checkpoint?.params.fields;
  let score: number | null = null;
  if (Array.isArray(fields)) {
    for (const f of fields) {
      if (f && typeof f === "object" && (f as { field?: unknown }).field === "gross_kg") {
        const s = (f as { score?: unknown }).score;
        if (typeof s === "number") score = s;
      }
    }
  }
  return { slip, field: "gross_kg", reading, score };
}

export interface StateInput {
  readonly committed: boolean;
  readonly skipped: boolean;
  readonly value: string;
  readonly preview: Preview | null;
}

/** W-TR-04's `data-state` (S1.7). */
export function byHandState({ committed, skipped, value, preview: p }: StateInput): ByHandState {
  if (committed) return "committed";
  if (skipped) return "skipped";
  if (!isComplete(value))
    return value.replace(SLOT, "").length > 0 && !value.includes(SLOT) ? "typing" : "empty";
  if (p?.matches === false) return "mismatch";
  if (p?.matches === true) return "match";
  return "typing";
}
