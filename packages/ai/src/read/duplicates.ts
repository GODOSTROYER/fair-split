import { hammingHex } from "./prep.js";
import type { CopyColour } from "./schema.js";

/**
 * Duplicate signals (S4.2) that feed the engine's DUPLICATE_SLIP rule. Slip rows only: logbook lines
 * are witnesses, never duplicates.
 * 1. EXACT_DOCUMENT: identical document sha256 (rejected at upload as `exact_duplicate_of`).
 * 2. SAME_SERIAL: one normalised serial on two rows, copy colours recorded (H1 is 0457 white in B and
 *    pink in D). Within one photo too: a white original and its pink carbon are one delivery.
 * 3. DHASH: a dHash distance of 8 or less between the reviewed rectangles of two slips in different
 *    documents. It only corroborates: a 64-bit hash of a whole slip is dominated by the printed
 *    template, so different slips score as close as re-shoots do (the code-drawn smoke slips: 3 of 6
 *    pairs at 8 or less), and two slots of one photo are two pieces of paper.
 * 4. MEMBER_DATE_KILOS: the same member, date and payable kilos under different serials, counted only
 *    with signal 3 (a re-shoot whose serial was misread), so two real deliveries on one day stay clean.
 *    Without a reviewed rectangle there is no dHash (pages until their template rectangles are
 *    reviewed; live reads without `cropFixture`), so there signal 4 cannot fire and a re-shoot whose
 *    serial was misread goes unpaired: the price of never pairing two real same-day deliveries.
 *
 * A pair is proposed on signal 1, on signal 2, or on signals 3 and 4 together; never on 3 alone (ADR 0003).
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
      const otherDocument = x.docId !== y.docId;
      const signals: DuplicateSignal[] = [];
      if (otherDocument && x.documentSha256 === y.documentSha256 && x.position === y.position) {
        signals.push("EXACT_DOCUMENT");
      }
      if (x.serial && y.serial && x.serial === y.serial) signals.push("SAME_SERIAL");
      const close =
        otherDocument && x.dhash !== null && y.dhash !== null && hammingHex(x.dhash, y.dhash) <= dhashMax;
      const sameDelivery =
        close &&
        x.serial !== y.serial &&
        !!x.memberNo &&
        x.memberNo === y.memberNo &&
        !!x.date &&
        x.date === y.date &&
        x.payableGrams !== null &&
        x.payableGrams === y.payableGrams;
      // The hash is recorded only beside a signal that stands on its own (or signal 4, which needs it).
      if (close && (signals.length > 0 || sameDelivery)) signals.push("DHASH");
      if (sameDelivery) signals.push("MEMBER_DATE_KILOS");
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
