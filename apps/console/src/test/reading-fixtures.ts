// Test support (no screen imports it): the two W-TR-03 states the recorded run never reaches, as the events that
// would put the room in them. The recorded run has no zoom that agrees (slip 0462's zoom fails at 0.40) and no
// blurred photo (register C-25: blur appears only in the eval set), so these fixtures stand in for reads the
// pipeline does return (S4.2 agreement rows 6 and 1):
//   `confirm-one`: slip 0462 read back after the zoom agreed with one of the two readings (0.80, decided by the
//      zoom): one tap confirms 64.80;
//   `blurred`: photo E with every field of all four slips illegible (score 0, no value).

import type { RunEvent, SeasonSnapshot } from "@fairsplit/contracts";
import {
  type EventStamp,
  extractRowEvent,
  type ReplayRow,
  replayRows,
} from "../features/reading/replay-fixture.js";

type Fields = ReplayRow["payload"]["fields"];

/** Slip 0462 after AI-3: the zoom reads the stained digit clearly and agrees with one of the two readings. */
export function zoomAgreedRow(snapshot: SeasonSnapshot, serial = "0462"): ReplayRow {
  const row = replayRows(snapshot).find((r) => r.serial === serial);
  if (!row) throw new Error(`slip ${serial} is not in the replay set`);
  const slip = snapshot.slips.find((s) => s.serial === serial && s.copy === "WHITE_ORIGINAL");
  const fields: Record<string, Fields[string]> = { ...row.payload.fields };
  for (const [field, box] of [
    ["gross_kg", "6"],
    ["net_kg", "8"],
  ] as const) {
    const before = fields[field];
    const value = slip?.boxes[box];
    if (!before || !value) continue;
    fields[field] = { value, score: 0.8, decidedBy: "zoom", display: before.display };
  }
  return { ...row, payload: { ...row.payload, fields } };
}

/** Every field illegible on both reads: what a photo too blurred to read returns, slip by slip. */
export function illegibleRows(snapshot: SeasonSnapshot, photoId: string): ReplayRow[] {
  return replayRows(snapshot)
    .filter((r) => r.photoId === photoId)
    .map((row) => {
      const fields: Record<string, Fields[string]> = {};
      for (const [name, f] of Object.entries(row.payload.fields)) {
        fields[name] = { value: null, score: 0, decidedBy: null, display: f.display.replace(/[^.]/g, "?") };
      }
      return { ...row, payload: { ...row.payload, memberNo: null, fields } };
    });
}

/** The rows as events, stamped in order. */
export function rowEvents(rows: readonly ReplayRow[]) {
  return (stamp: (offset: number) => EventStamp): RunEvent[] =>
    rows.map((row, i) => extractRowEvent(row, stamp(i)));
}
