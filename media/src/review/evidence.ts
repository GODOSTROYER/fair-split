import { z } from "zod";
import type { Slot } from "../fixtures/schema.js";

/**
 * What a trap verdict may rest on (verify:media minor: `--evidence` used to accept any non-empty file in
 * the repo, README.md included). The evidence is a WS-READ eval report: only a report scores both reads of
 * a slip against its label, so its slip cell says whether the stained fields went to a person (WATER_STAIN,
 * label `LOW_CONFIDENCE` with gross and net `HUMAN`) or the note was quarantined (MARGIN_NOTE, `INJECTION`).
 * A recording under `packages/eval/recordings/` is one call and names no case or slot, so it cannot.
 *
 * The report must hold this slip's cell (`{fixture id}#{slot}`, the label's case id is the fixture id),
 * agree with the verdict, and be generated after the exec that made the current master: READ's v1 report
 * names no image hash, so time is what ties it to these pixels. A cell that carries `image_sha256` (not in
 * READ's report yet; asked for downstream) must name this master.
 */

/** Where WS-READ writes eval reports (`report/latest.json`, `report/history/*.json`), repo-relative. */
export const READ_REPORT_DIR = "packages/eval/report/";

/** The part of WS-READ's `EvalReport` (packages/eval/src/report.ts, v1) a verdict rests on. */
export const ReadReport = z.object({
  v: z.literal(1),
  generated_at: z.iso.datetime(),
  mode: z.enum(["replay", "live", "batch"]),
  set: z.enum(["test", "dev"]),
  cases: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["slip", "logbook", "rate_card"]),
      pass: z.boolean().nullable(),
      reasons: z.array(z.string()),
      image_sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    }),
  ),
});
export type ReadReport = z.infer<typeof ReadReport>;

export interface EvidenceInput {
  /** The evidence file, repo-relative with forward slashes. */
  file: string;
  bytes: Uint8Array;
  fixtureId: string;
  slot: Slot;
  status: "HOLDS" | "FAILED";
  /** The fixture's image: the current master. */
  masterSha256: string;
  /** When the exec that made the current master started (the manifest's accepted attempt), or null. */
  masterMadeAt: string | null;
}

export type EvidenceJudgement = { ok: true; note: string } | { ok: false; why: string };

/** Whether a file is a WS-READ eval report that read this slip of this master and agrees with the verdict. */
export function judgeReadReport(e: EvidenceInput): EvidenceJudgement {
  const no = (why: string): EvidenceJudgement => ({ ok: false, why });
  if (!e.file.startsWith(READ_REPORT_DIR) || !e.file.endsWith(".json") || e.file.split("/").includes("..")) {
    return no(
      `the evidence must be a WS-READ eval report under ${READ_REPORT_DIR} (latest.json or history/*.json): only a report scores both reads of a slip against its label; ${e.file} is not one`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(e.bytes).toString("utf8"));
  } catch {
    return no(`${e.file} is not JSON, so it is not a WS-READ eval report`);
  }
  const parsed = ReadReport.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return no(
      `${e.file} is not a WS-READ eval report (${issue ? `${issue.path.join(".") || "root"}: ${issue.message}` : "invalid"})`,
    );
  }
  const report = parsed.data;
  const id = `${e.fixtureId}#${e.slot}`;
  const cell = report.cases.find((c) => c.id === id && c.kind === "slip");
  if (!cell) return no(`the report has no slip cell ${id}: it did not read this slip`);
  if (cell.image_sha256 && cell.image_sha256 !== e.masterSha256) {
    return no(
      `the report read other pixels for ${id} (sha256 ${cell.image_sha256.slice(0, 12)}…, the master is ${e.masterSha256.slice(0, 12)}…)`,
    );
  }
  if (!e.masterMadeAt) {
    return no("the manifest records no accepted exec for this master, so no report can be tied to it");
  }
  if (Date.parse(report.generated_at) < Date.parse(e.masterMadeAt)) {
    return no(
      `the report (generated ${report.generated_at}) predates this master (its exec started ${e.masterMadeAt}): it read other pixels`,
    );
  }
  const reasons = cell.reasons.length ? cell.reasons.join("; ") : "no reasons given";
  if (cell.pass === null) return no(`the report did not evaluate ${id} (pass: null; ${reasons})`);
  if (e.status === "HOLDS" && !cell.pass) {
    return no(`the report fails ${id} (${reasons}), so it cannot show the trap holds`);
  }
  if (e.status === "FAILED" && cell.pass) {
    return no(`the report passes ${id}, so it cannot show the trap failed`);
  }
  return {
    ok: true,
    note: `READ ${report.mode}/${report.set} report of ${report.generated_at}: ${id} ${cell.pass ? "pass" : `fail (${reasons})`}${cell.image_sha256 ? ", image pinned by sha256" : ""}`,
  };
}
