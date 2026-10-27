// Which field ID `POST /v1/fields/:fieldId/enter` takes for slip 0462's gross weight. IC-01 carries no field
// IDs to the console before the entry (hold.raised has none, and there is no field read), so until it does
// (reported to WS-CORE and WS-API: `hold.raised.fieldIds` or a fields read) the console resolves it here:
//   1. a `field.entered` the run already streamed for this slip and field;
//   2. against api-client's mock, its deterministic ID (`mockId("field:{serial}:{field}")`, README "IDs are
//      deterministic"), derived with the console's own SHA-256;
//   3. otherwise the engine's pending-field ID from the snapshot's read checkpoint.

import type { SeasonSnapshot, SlipFieldName } from "@fairsplit/contracts";
import type { RunView } from "../../data/run-view.js";
import type { DataSource } from "../../lib/env.js";
import { sha256Hex } from "../../lib/sha256.js";

/** api-client/msw's `mockId(label)`: a stable UUID (version 7 layout, variant 10) derived from the label. */
export function mockFieldId(label: string): string {
  const h = sha256Hex(`fairsplit-mock:${label}`);
  const variant = ((Number.parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function checkpointFieldId(snapshot: SeasonSnapshot, serial: string, field: SlipFieldName): string | null {
  const holdKeys = snapshot.holds
    .filter((h) => h.kind === "LOW_CONFIDENCE" && h.serials.includes(serial))
    .map((h) => h.key);
  for (const hold of snapshot.checkpoints.read.holds) {
    if (!holdKeys.includes(hold.key)) continue;
    const fields = hold.params.fields;
    if (!Array.isArray(fields)) continue;
    for (const f of fields) {
      if (!f || typeof f !== "object") continue;
      const entry = f as { field?: unknown; fieldId?: unknown };
      if (entry.field === field && typeof entry.fieldId === "string") return entry.fieldId;
    }
  }
  return null;
}

export function resolveFieldId(input: {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot;
  readonly serial: string;
  readonly field: SlipFieldName;
  readonly source: DataSource;
}): string | null {
  const { view, snapshot, serial, field, source } = input;
  const entered = Object.values(view?.fields ?? {}).find((f) => f.serial === serial && f.field === field);
  if (entered) return entered.fieldId;
  if (source === "mock") return mockFieldId(`field:${serial}:${field}`);
  return checkpointFieldId(snapshot, serial, field);
}
