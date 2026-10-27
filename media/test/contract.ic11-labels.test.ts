import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_DEV_GROUPS, SPIKE_ASSETS } from "../src/content/spike.js";
import { Fixture } from "../src/fixtures/schema.js";
import { buildLabel } from "../src/labels/build.js";
import { CaseLabel, LABEL_SCHEMA_ID, labelJsonSchema } from "../src/labels/schema.js";
import { LABEL_SCHEMA_FILE, LABELS_DIR, PROVISIONAL_DIR } from "../src/labels/sync.js";
import { MEDIA_ROOT } from "../src/util/env.js";
import { loadLikeRead, ReadCaseLabel, ReadSlipLabel } from "./contract/read-case-label.js";

/**
 * IC-11 label contract with WS-READ: the eval loads `media/eval/labels/*.json` with a strict schema
 * (`test/contract/read-case-label.ts` is READ's copy), so a label with one key too many fails the S3 run.
 * These tests hold media to that shape, and keep agent-checked labels out of the folder READ scores.
 */

function folder(dir: string): Array<{ file: string; json: unknown }> {
  const abs = join(MEDIA_ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, json: JSON.parse(readFileSync(join(abs, file), "utf8")) as unknown }));
}

const scored = folder(LABELS_DIR);
const provisional = folder(PROVISIONAL_DIR);
const all = [...scored, ...provisional];

const fixtureStatus = (caseId: string): string =>
  Fixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", `${caseId}.json`), "utf8"))).review
    .status;

/** The JSON Schema object at `properties.<key>` (or `items` of an array). */
type JsonSchemaNode = {
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  additionalProperties?: unknown;
};

describe("IC-11 label contract: every label loads in WS-READ's strict eval loader", () => {
  it("every committed label, scored or provisional, parses with READ's CaseLabel and loses nothing", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const { file, json } of all) {
      const r = ReadCaseLabel.safeParse(json);
      expect(r.success, `${file}: ${r.success ? "" : r.error.message}`).toBe(true);
      // Every key is written out, so READ's defaults never fill a gap and the parse is the file itself.
      expect(r.data).toEqual(json);
    }
  });

  it("READ's loader finds no invalid label in either folder, and only person-checked cases by default", () => {
    const byDefault = loadLikeRead(scored, "dev");
    expect(byDefault.invalid).toEqual([]);
    for (const c of byDefault.cases) expect(fixtureStatus(c.case), c.case).toBe("human-reviewed");
    // An agent-checked case is loaded only by a run that names eval/provisional (--labels): provisional.
    const named = loadLikeRead(provisional, "dev");
    expect(named.invalid).toEqual([]);
    expect(named.cases.length).toBe(provisional.length);
    for (const c of named.cases) expect(fixtureStatus(c.case), c.case).toBe("agent-checked");
  });

  it("every label media builds from the committed fixtures parses with READ's CaseLabel", () => {
    let built = 0;
    for (const a of SPIKE_ASSETS.filter((x) => EVAL_DEV_GROUPS.includes(x.group))) {
      const path = join(MEDIA_ROOT, "fixtures", `${a.id}.json`);
      if (!existsSync(path)) continue;
      const label = buildLabel(Fixture.parse(JSON.parse(readFileSync(path, "utf8"))), a);
      if (!label) continue;
      built++;
      const r = ReadCaseLabel.safeParse(label);
      expect(r.success, `${a.id}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
    expect(built).toBe(all.length);
  });

  it("has READ's keys exactly, at case and slip level, and allows no others", () => {
    const schema = labelJsonSchema() as JsonSchemaNode;
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(Object.keys(ReadCaseLabel.shape).sort());
    expect(schema.additionalProperties).toBe(false);
    const slip = schema.properties?.slips?.items;
    expect(Object.keys(slip?.properties ?? {}).sort()).toEqual(Object.keys(ReadSlipLabel.shape).sort());
    expect(slip?.additionalProperties).toBe(false);
  });

  it("refuses v, synthetic and status (the keys that failed every S3 case) on both sides", () => {
    const sample = all[0]?.json as Record<string, unknown>;
    expect(CaseLabel.safeParse(sample).success).toBe(true);
    for (const extra of [{ v: 1 }, { synthetic: true }, { status: "agent-checked" }]) {
      expect(ReadCaseLabel.safeParse({ ...sample, ...extra }).success).toBe(false);
      expect(CaseLabel.safeParse({ ...sample, ...extra }).success).toBe(false);
    }
  });

  it("publishes the generated JSON Schema, versioned by its $id, beside the label folders", () => {
    const committed = JSON.parse(readFileSync(join(MEDIA_ROOT, LABEL_SCHEMA_FILE), "utf8")) as unknown;
    expect(committed).toEqual(labelJsonSchema());
    expect((committed as { $id?: string }).$id).toBe(LABEL_SCHEMA_ID);
  });
});
