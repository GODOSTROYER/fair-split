// The inline hold notes under their held rows (ADR-0016, decision.md §3, graft 2 from B; unslop spec §3.6). Under H1:
// one line with the white and pink slip swatches, "Slip 0457 ×2" and the micro facts "4/4 fields match · 42.00 kg".
// Under H2 (UI gate round 4: the figure leaves the Verified kg cell): "2.14 kg a tree" and its limit. Each has one
// quiet "Open H1" / "Open H2" into the existing drawer and carries no decision slab: the drawer stays the only place
// to decide, so no role selector there becomes ambiguous. The serial, the copies, the count and the per-tree figure
// all come from the row's own slips, the seed's sheets and the line's own kilos (holds/model.ts twinRows), never typed.

import type { SnapshotSlip } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { twinRows } from "../holds/model.js";
import type { RowSlip, SplitRow } from "./model.js";
import { SPLIT } from "./shared/copy.js";
import { COPY_FILL } from "./shared/SlipPaper.js";

interface NoteBase {
  readonly kind: "note";
  /** The grid's row ID: "note-" and the held member's number. */
  readonly memberNo: string;
  /** The held line the note sits under. */
  readonly forMember: string;
  readonly label: string;
}

/** H1: one slip on a line twice, as a white original and a pink duplicate. */
export interface DuplicateNoteRow extends NoteBase {
  readonly hold: "DUPLICATE_SLIP";
  readonly serial: string;
  readonly white: RowSlip;
  readonly pink: RowSlip;
  /** Fields the two copies share, compared as written; null when a sheet is not in the seed. */
  readonly matched: number | null;
  readonly fields: number;
  /** The net kilos both copies carry, as written on the white original ("42.00"); null without the sheet. */
  readonly netKg: string | null;
}

/** H2: more kilos than the member's registered trees can grow. */
export interface YieldNoteRow extends NoteBase {
  readonly hold: "IMPLAUSIBLE_YIELD";
  /** "2.14": kilos a registered tree (the line's own `kgPerTree`). */
  readonly perTree: string;
  /** "1.6": the ratified limit. */
  readonly limit: string;
  readonly trees: number;
}

export type HoldNoteRow = DuplicateNoteRow | YieldNoteRow;

/** A serial that sits on one line twice, as a white original and a pink duplicate. */
export function duplicateSerial(slips: readonly RowSlip[]): string | null {
  const seen = new Set<string>();
  for (const s of slips) {
    if (seen.has(s.serial)) return s.serial;
    seen.add(s.serial);
  }
  return null;
}

/** The note for the open duplicate hold (H1), or null once it is decided or filtered away. */
export function holdNote(
  rows: readonly SplitRow[],
  slip?: (serial: string, copy: SnapshotSlip["copy"]) => SnapshotSlip | undefined,
): DuplicateNoteRow | null {
  for (const row of rows) {
    if (row.status.kind !== "held" || row.status.hold.kind !== "DUPLICATE_SLIP") continue;
    const serial = duplicateSerial(row.slips);
    if (!serial) continue;
    const white = row.slips.find((s) => s.serial === serial && s.copy === "WHITE_ORIGINAL");
    const pink = row.slips.find((s) => s.serial === serial && s.copy === "PINK_DUPLICATE");
    if (!white || !pink) continue;
    const a = slip?.(serial, "WHITE_ORIGINAL");
    const b = slip?.(serial, "PINK_DUPLICATE");
    const twins = a && b ? twinRows(a, b) : null;
    return {
      kind: "note",
      hold: "DUPLICATE_SLIP",
      memberNo: `note-${row.memberNo}`,
      forMember: row.memberNo,
      label: row.status.hold.label,
      serial,
      white,
      pink,
      matched: twins ? twins.filter((t) => t.match).length : null,
      fields: twins ? twins.length : 4,
      netKg: a?.boxes["8"] || null,
    };
  }
  return null;
}

/** The note for the open per-tree hold (H2), or null once it is decided or filtered away. */
export function yieldNote(rows: readonly SplitRow[], limit: string): YieldNoteRow | null {
  for (const row of rows) {
    if (row.status.kind !== "held" || row.status.hold.kind !== "IMPLAUSIBLE_YIELD") continue;
    return {
      kind: "note",
      hold: "IMPLAUSIBLE_YIELD",
      memberNo: `note-${row.memberNo}`,
      forMember: row.memberNo,
      label: row.status.hold.label,
      perTree: row.kgPerTree,
      limit,
      trees: row.trees,
    };
  }
  return null;
}

/** Every open hold's note, H1's first. */
export function holdNotes(
  rows: readonly SplitRow[],
  limit: string,
  slip?: (serial: string, copy: SnapshotSlip["copy"]) => SnapshotSlip | undefined,
): HoldNoteRow[] {
  return [holdNote(rows, slip), yieldNote(rows, limit)].filter((n): n is HoldNoteRow => n !== null);
}

export function HoldNoteView({ note, onOpen }: { readonly note: HoldNoteRow; readonly onOpen: () => void }) {
  return (
    <div className="fsr-note" data-hold={note.hold} data-testid={`W-TR-05.note.${note.label}`}>
      {note.hold === "DUPLICATE_SLIP" ? (
        <>
          <span className="fsr-note__thumbs" aria-hidden>
            {[note.white, note.pink].map((s) => (
              <span key={s.copy} className="fsr-note__thumb" style={{ background: COPY_FILL[s.copy] }}>
                {s.photoId}
              </span>
            ))}
          </span>
          <p className="fsr-note__words fs-t-body">
            <b>Slip {note.serial} ×2</b>{" "}
            <span className="fsr-note__micro fs-t-micro">
              {note.matched === null
                ? "white original · pink copy"
                : [
                    `${note.matched}/${note.fields} fields match`,
                    ...(note.netKg ? [`${note.netKg} kg`] : []),
                  ].join(" · ")}
            </span>
          </p>
        </>
      ) : (
        <>
          <span className="fsr-note__mark" aria-hidden>
            <Glyph name="plot" size={16} />
          </span>
          <p className="fsr-note__words fs-t-body">
            <b>{SPLIT.perTreeNote(note.perTree)}</b>{" "}
            <span className="fsr-note__micro fs-t-micro">
              {SPLIT.perTreeNoteMicro(note.limit, note.trees)}
            </span>
          </p>
        </>
      )}
      <button
        type="button"
        className="fs-flat fsr-note__open"
        onClick={onOpen}
        data-testid={`W-TR-05.note.${note.label}.open`}
      >
        {SPLIT.openNote(note.label)}
      </button>
    </div>
  );
}
