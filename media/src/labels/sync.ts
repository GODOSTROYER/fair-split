import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AssetSpec } from "../content/types.js";
import type { Fixture } from "../fixtures/schema.js";
import { writeJson } from "../util/json.js";
import { buildLabel } from "./build.js";
import { CaseLabel, labelJsonSchema } from "./schema.js";

/** IC-11: one label per eval case. Only label files live here (WS-READ's loader reads every `*.json`). */
export const LABELS_DIR = join("eval", "labels");
/** The labels' JSON Schema sits beside the folder, never in it. */
export const LABEL_SCHEMA_FILE = join("eval", "label.schema.json");

export interface SyncResult {
  written: string[];
  /** Labels removed because their fixture went back to draft (a stale label must not outlive its check). */
  removed: string[];
}

/**
 * Writes `media/eval/labels/{case}.json` for every asset of an eval group whose fixture has been checked,
 * and removes the label of one whose fixture is a draft again. Labels of other cases are left alone.
 */
export async function syncLabels(
  mediaRoot: string,
  assets: readonly AssetSpec[],
  evalGroups: readonly string[],
  readFixture: (id: string) => Promise<Fixture | null>,
): Promise<SyncResult> {
  const out: SyncResult = { written: [], removed: [] };
  for (const a of assets) {
    if (!evalGroups.includes(a.group)) continue;
    const path = join(mediaRoot, LABELS_DIR, `${a.id}.json`);
    const f = await readFixture(a.id);
    const label = f ? buildLabel(f, a) : null;
    if (label) {
      await writeJson(path, CaseLabel.parse(label));
      out.written.push(a.id);
    } else if (existsSync(path)) {
      await rm(path);
      out.removed.push(a.id);
    }
  }
  return out;
}

export async function writeLabelSchema(mediaRoot: string): Promise<void> {
  await writeJson(join(mediaRoot, LABEL_SCHEMA_FILE), labelJsonSchema());
}
