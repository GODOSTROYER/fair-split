// Which field ID `POST /v1/fields/:fieldId/enter` takes for a by-hand entry. It must be the session run's own
// field: the showcase's IDs (the snapshot's engine checkpoints) belong to another run, and posting one would
// enter a value into a field this session does not own. IC-01 names no field before the entry: `hold.raised`
// carries no field IDs and fs-api has no field read (requested from WS-CORE and WS-API as
// `hold.raised.fieldIds`, or a read of the run's fields). Until then the console resolves the ID only from what
// the session run itself has said:
//   1. a `field.entered` the run already streamed for this slip and field;
//   2. a read of the run's fields, when one answers. Today only the mock API's world does (./mock-fields.ts).
// Anything else is no ID at all, and the by-hand slab says why it can't be pressed.

import type { SeasonSnapshot, SlipFieldName } from "@fairsplit/contracts";
import type { RunView } from "../../data/run-view.js";

/** One field as a read of the run's fields names it (the shape of IC-01's SlipFieldDTO it needs). */
export interface FieldRef {
  readonly id: string;
  readonly serial?: string;
  readonly slipRowId: string;
  readonly field: string;
}

export interface FieldIdInput {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot;
  readonly serial: string;
  readonly field: SlipFieldName;
  /** The run's fields as a field read answered them, or null when nothing can read them. */
  readonly fields: readonly FieldRef[] | null;
}

export function resolveFieldId({ view, snapshot, serial, field, fields }: FieldIdInput): string | null {
  const entered = Object.values(view?.fields ?? {}).find((f) => f.serial === serial && f.field === field);
  if (entered) return entered.fieldId;
  if (!fields) return null;
  // The read names fields by their slip row; the run's rows for this serial (white original and any copy).
  const rows = new Set(snapshot.slips.filter((s) => s.serial === serial).map((s) => s.rowId));
  return fields.find((f) => f.field === field && (f.serial === serial || rows.has(f.slipRowId)))?.id ?? null;
}
