// The `extract.row` events the recorded reading replays (S1.7 W-TR-03, MM-2), built from the seed in the shape
// packages/ai's reader emits them: one row per slip of the replay set (photos A to L, 48 slips), each field with
// the value the two reads agreed on, the agreement score and who decided it. Slip 0462's stained gross and net
// go to a person (0.40); slip 0449's margin note is quarantined. api-client's mock does not emit these yet
// (escalated to WS-API: the mock can take this builder as it is); until it does, the season slice's tests feed
// them into the run's stream, and the reading room's mock-only replay (./replay.ts) plays them on the page.
// Nothing reads them against fs-api.

import type { RunEvent, RunEventOf, SeasonSnapshot, SlipFieldName } from "@fairsplit/contracts";
import { type PhotoSlip, POSITIONS, photoSlips, stainedReading } from "./slip.js";

type RowPayload = RunEventOf<"extract.row">["payload"];
type FieldOut = RowPayload["fields"][string];

const BOX_FIELDS: readonly [SlipFieldName, keyof PhotoSlip["slip"]["boxes"]][] = [
  ["date", "1"],
  ["member_no", "2"],
  ["member_name", "3"],
  ["plot_no", "4"],
  ["sacks", "5"],
  ["gross_kg", "6"],
  ["tare_kg", "7"],
  ["net_kg", "8"],
  ["mc_pct", "9"],
  ["mc_less_kg", "10"],
  ["payable_kg", "11"],
  ["grade", "12"],
];

/** A deterministic agreement score in [0.91, 0.99] for a field that two reads agreed on. */
function agreedScore(serial: string, field: string): number {
  let h = 0;
  for (const c of `${serial}:${field}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Math.round((0.91 + (h % 9) / 100) * 100) / 100;
}

/** The fields of one slip as the reader reports them. */
export function rowFields(slip: PhotoSlip["slip"]): RowPayload["fields"] {
  const out: Record<string, FieldOut> = {
    serial: {
      value: slip.serial,
      score: agreedScore(slip.serial, "serial"),
      decidedBy: "agreement",
      display: slip.serial,
    },
  };
  for (const [field, box] of BOX_FIELDS) {
    const text = slip.boxes[box];
    if (typeof text !== "string" || text.length === 0) continue;
    const stained = stainedReading(slip, field);
    out[field] = stained
      ? { value: null, score: 0.4, decidedBy: null, display: stained }
      : { value: text, score: agreedScore(slip.serial, field), decidedBy: "agreement", display: text };
  }
  return out;
}

export interface ReplayRow {
  readonly photoId: string;
  readonly serial: string;
  readonly payload: RowPayload;
}

/** Every replayed row, photo by photo (A to L), slip by slip (TL, TR, BL, BR). */
export function replayRows(snapshot: SeasonSnapshot): ReplayRow[] {
  const photos = snapshot.photos
    .filter((p) => p.set === "REPLAY")
    .sort((a, b) => a.photoId.localeCompare(b.photoId));
  const rows: ReplayRow[] = [];
  for (const photo of photos) {
    for (const { position, slip } of photoSlips(photo, snapshot.slips)) {
      rows.push({
        photoId: photo.photoId,
        serial: slip.serial,
        payload: {
          docId: photo.documentId,
          row: POSITIONS.indexOf(position),
          serial: slip.serial,
          memberNo: slip.memberNo,
          fields: rowFields(slip),
        },
      });
    }
  }
  return rows;
}

export interface EventStamp {
  readonly id: string;
  readonly at: string;
  readonly ws: string;
  readonly runId: string | null;
}

/**
 * One `extract.row` RunEvent. As a stand-in for the recording (`seeded`, the page's mock-only replay) it is the
 * seed's own text with placeholder agreement scores, attributed to the seed, never to Claude: no model read it,
 * and the page shows none of its scores. Tests that model a recorded reading pass `replay`.
 */
export function extractRowEvent(
  row: ReplayRow,
  stamp: EventStamp,
  provenance: "replay" | "seeded" = "replay",
): RunEvent {
  return {
    id: stamp.id,
    ws: stamp.ws,
    runId: stamp.runId,
    at: stamp.at,
    actor:
      provenance === "seeded"
        ? { kind: "system", id: "seed", impersonatedBy: null }
        : { kind: "agent", id: "claude-opus-5-5", impersonatedBy: null },
    provenance,
    type: "extract.row",
    payload: row.payload,
  } as RunEvent;
}

/** Slip 0449's margin note, quarantined: never a prompt, shown as a notice (register §2). */
export function quarantineEvent(
  snapshot: SeasonSnapshot,
  stamp: EventStamp,
  provenance: "replay" | "seeded" = "replay",
): RunEvent | null {
  const notice = snapshot.quarantineNotices[0];
  if (!notice) return null;
  const photo = snapshot.photos.find((p) => p.photoId === notice.photoId);
  const slip = snapshot.slips.find((s) => s.serial === notice.serial && s.photoId === notice.photoId);
  if (!photo || !slip) return null;
  return {
    id: stamp.id,
    ws: stamp.ws,
    runId: stamp.runId,
    at: stamp.at,
    actor:
      provenance === "seeded"
        ? { kind: "system", id: "seed", impersonatedBy: null }
        : { kind: "agent", id: "claude-opus-5-5", impersonatedBy: null },
    provenance,
    type: "extract.quarantined",
    payload: { docId: photo.documentId, row: POSITIONS.indexOf(slip.position), box: null, source: "screen" },
  } as RunEvent;
}
