// The inline hold summary under the held H1 row (ADR-0016, decision.md §3, graft 2 from B; unslop spec §3.6): one
// line in the grid with the white and pink slip thumbnails, "Slip 0457 ×2" and the micro facts "4/4 fields match ·
// 42.00 kg", and one quiet "Open H1" that opens the existing drawer. It carries no decision slab:
// the drawer stays the only place to decide, so no role selector there becomes ambiguous. The serial, the copies
// and the count all come from the row's own slips and the seed's sheets (holds/model.ts twinRows), never typed.

import type { SnapshotSlip } from "@fairsplit/contracts";
import { twinRows } from "../holds/model.js";
import type { RowSlip, SplitRow } from "./model.js";
import { COPY_FILL } from "./shared/SlipPaper.js";

export interface HoldNoteRow {
  readonly kind: "note";
  /** The grid's row ID: "note-" and the held member's number. */
  readonly memberNo: string;
  /** The held line the note sits under. */
  readonly forMember: string;
  readonly label: string;
  readonly serial: string;
  readonly white: RowSlip;
  readonly pink: RowSlip;
  /** Fields the two copies share, compared as written; null when a sheet is not in the seed. */
  readonly matched: number | null;
  readonly fields: number;
  /** The net kilos both copies carry, as written on the white original ("42.00"); null without the sheet. */
  readonly netKg: string | null;
}

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
): HoldNoteRow | null {
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

export function HoldNoteView({ note, onOpen }: { readonly note: HoldNoteRow; readonly onOpen: () => void }) {
  return (
    <div className="fsr-note" data-testid={`W-TR-05.note.${note.label}`}>
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
      <button
        type="button"
        className="fs-flat fsr-note__open"
        onClick={onOpen}
        data-testid={`W-TR-05.note.${note.label}.open`}
      >
        Open {note.label}
      </button>
    </div>
  );
}
