import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AssetSpec } from "../content/types.js";
import type { Fixture } from "../fixtures/schema.js";
import { writeJson } from "../util/json.js";
import { buildLabel, labelStatus } from "./build.js";
import { CaseLabel, LABEL_STATUSES, type LabelStatus, labelJsonSchema } from "./schema.js";

/**
 * IC-11: one label per eval case, in the folder its review status names. Only label files live in these
 * folders (WS-READ's loader reads every `*.json` of the folder it is given).
 */
/** Labels a person checked (C-24): the truth the eval scores by default (`cases.ts` loads this folder). */
export const LABELS_DIR = join("eval", "labels");
/** Labels only an agent checked: provisional, scored only by a run that names this folder. */
export const PROVISIONAL_DIR = join("eval", "provisional");
/** The labels' JSON Schema sits beside the folders, never in one. */
export const LABEL_SCHEMA_FILE = join("eval", "label.schema.json");

/** The folder (relative to the media root) that holds labels of a review status. */
export function labelDir(status: LabelStatus): string {
  return status === "human-reviewed" ? LABELS_DIR : PROVISIONAL_DIR;
}

export interface SyncResult {
  /** Person-checked labels written to `eval/labels/`. */
  written: string[];
  /** Agent-checked labels written to `eval/provisional/` (provisional until a person reviews them). */
  provisional: string[];
  /** Labels removed because their fixture went back to draft (a stale label must not outlive its check). */
  removed: string[];
}

/**
 * Writes the label of every asset of an eval group whose fixture has been checked, to `eval/labels/` once a
 * person reviewed the fixture and to `eval/provisional/` while only an agent did, and removes it from the
 * other folder, so a case has one label in one place. The label of a fixture that is a draft again is
 * removed from both. Labels of other cases are left alone.
 */
export async function syncLabels(
  mediaRoot: string,
  assets: readonly AssetSpec[],
  evalGroups: readonly string[],
  readFixture: (id: string) => Promise<Fixture | null>,
): Promise<SyncResult> {
  const out: SyncResult = { written: [], provisional: [], removed: [] };
  for (const a of assets) {
    if (!evalGroups.includes(a.group)) continue;
    const f = await readFixture(a.id);
    const label = f ? buildLabel(f, a) : null;
    const status = f && label ? labelStatus(f) : null;
    let removed = false;
    for (const s of LABEL_STATUSES) {
      const path = join(mediaRoot, labelDir(s), `${a.id}.json`);
      if (s !== status && existsSync(path)) {
        await rm(path);
        removed = true;
      }
    }
    if (label && status) {
      await writeJson(join(mediaRoot, labelDir(status), `${a.id}.json`), CaseLabel.parse(label));
      (status === "human-reviewed" ? out.written : out.provisional).push(a.id);
    } else if (removed) {
      out.removed.push(a.id);
    }
  }
  return out;
}

export async function writeLabelSchema(mediaRoot: string): Promise<void> {
  await writeJson(join(mediaRoot, LABEL_SCHEMA_FILE), labelJsonSchema());
}
