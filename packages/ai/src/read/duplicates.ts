import { hammingHex } from "./prep.js";
import type { CopyColour } from "./schema.js";

/**
 * Duplicate signals (S4.2) that feed the engine's DUPLICATE_SLIP rule. Slip rows only: logbook lines
 * are witnesses, never duplicates.
 * 1. Identical document sha256 (rejected at upload as `exact_duplicate_of`).
 * 2. The same normalised serial on two rows (copy colours recorded: H1 is 0457 white and pink).
 * 3. A dHash distance of 8 or less between two slip crops (a re-shoot).
 * 4. The same member, date and payable kilos under different serials — raised only together with
 *    signal 3, so two real deliveries on one day stay clean.
 */
export type DuplicateSignal = "EXACT_DOCUMENT" | "SAME_SERIAL" | "DHASH" | "MEMBER_DATE_KILOS";

export interface DuplicateCandidate {
  id: string;
  docId: string;
  documentSha256: string;
  /** Position of the slip in its document (fixture slot or read order). */
  position: number;
  copy: CopyColour;
  serial: string | null;
  memberNo: string | null;
  date: string | null;
  payableGrams: number | null;
  dhash: string | null;
}

export interface DuplicatePair {
  a: string;
  b: string;
  signals: DuplicateSignal[];
  copies: [CopyColour, CopyColour];
}

export const DHASH_MAX_DISTANCE = 8;

export function duplicatePairs(
  rows: readonly DuplicateCandidate[],
  dhashMax = DHASH_MAX_DISTANCE,
): DuplicatePair[] {
  const slips = rows.filter((r) => r.copy !== "LOGBOOK_LINE");
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < slips.length; i++) {
    for (let j = i + 1; j < slips.length; j++) {
      const x = slips[i] as DuplicateCandidate;
      const y = slips[j] as DuplicateCandidate;
      const signals: DuplicateSignal[] = [];
      if (x.docId !== y.docId && x.documentSha256 === y.documentSha256 && x.position === y.position) {
        signals.push("EXACT_DOCUMENT");
      }
      if (x.serial && y.serial && x.serial === y.serial) signals.push("SAME_SERIAL");
      const dhash = x.dhash !== null && y.dhash !== null && hammingHex(x.dhash, y.dhash) <= dhashMax;
      if (dhash) signals.push("DHASH");
      if (
        dhash &&
        x.serial !== y.serial &&
        x.memberNo &&
        x.memberNo === y.memberNo &&
        x.date &&
        x.date === y.date &&
        x.payableGrams !== null &&
        x.payableGrams === y.payableGrams
      ) {
        signals.push("MEMBER_DATE_KILOS");
      }
      if (signals.length > 0) pairs.push({ a: x.id, b: y.id, signals, copies: [x.copy, y.copy] });
    }
  }
  return pairs;
}

/** Signal 1 at upload time: the earlier document with the same sha256, if any. */
export function exactDuplicateOf(
  sha256: string,
  existing: ReadonlyArray<{ id: string; sha256: string }>,
): string | null {
  return existing.find((d) => d.sha256 === sha256)?.id ?? null;
}

/** The duplicate candidate of an extracted row (best values: auto-accepted, else as proposed). */
export function candidateOf(
  doc: { docId: string; documentSha256: string },
  row: {
    row: number;
    copy: CopyColour;
    serial: string;
    memberNo: string;
    dhash: string | null;
    fields: Partial<Record<string, { outcome: { value: string } | null } | undefined>>;
  },
): DuplicateCandidate {
  const value = (f: string) => row.fields[f]?.outcome?.value || null;
  const payable = value("payable_kg");
  const grams = payable && /^\d{1,3}\.\d{2}$/.test(payable) ? Math.round(Number(payable) * 1000) : null;
  return {
    id: `${doc.docId}#${row.row}`,
    docId: doc.docId,
    documentSha256: doc.documentSha256,
    position: row.row,
    copy: row.copy,
    serial: /^\d{4}$/.test(row.serial) ? row.serial : null,
    memberNo: /^M-\d{3}$/.test(row.memberNo) ? row.memberNo : null,
    date: value("date"),
    payableGrams: grams,
    dhash: row.dhash,
  };
}
