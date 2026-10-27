import { z } from "zod";
import {
  Expect,
  type FieldFixture,
  type Fixture,
  LEGIBILITY,
  type LogbookPageFixture,
  type NRect,
  SLOTS,
  type SlipImageFixture,
  slipFieldEntries,
  type TrapCheck,
} from "../fixtures/schema.js";
import { fixtureFields } from "../imagegen/review.js";
import { SLIP_BOXES } from "../template/slip-template.js";

/**
 * One person's pass over a fixture in the review page (S4.10 "Review grid"): every field's crop beside the
 * value it should show; Enter accepts, typing records what is visible. The submission becomes the fields'
 * `visible`, `legibility` and `expect` with `checkedBy: "human"`, and is kept under media/review/sessions/.
 */

export interface ReviewItem {
  /** Index into the item list (the crop URL uses it). */
  i: number;
  /** The field's `where` path (see imagegen/review.ts). */
  path: string;
  title: string;
  rect: NRect;
  value: string;
  requested: string;
  visible: string;
  legibility: string;
  expect: string;
  checkedBy: string | null;
}

export interface TrapItem {
  slot: string;
  trap: TrapCheck["trap"];
  status: TrapCheck["status"];
  by: TrapCheck["by"];
  evidence: string;
  question: string;
}

const ROW_LABEL: Record<string, string> = Object.fromEntries(
  SLIP_BOXES.flatMap((b) =>
    b.fields.map((f, i) => [f, `${b.no} ${b.label}${b.lines === 2 ? `, line ${i + 1}` : ""}`]),
  ),
);

function slipTitle(path: string): string {
  const m = /^(fields\.(\w+)|deductions\.(\d)|signature|anomalies\.(\d))$/.exec(path);
  if (!m) return path;
  if (m[2]) return m[2] === "serial" ? "Serial (red, printed)" : (ROW_LABEL[m[2]] ?? m[2]);
  if (m[3] !== undefined) return ROW_LABEL[`deduction_${Number(m[3]) + 1}`] ?? path;
  if (m[4] !== undefined) return "Note outside the boxes";
  return "Pirma / Thumbmark";
}

const TRAP_QUESTIONS: Record<TrapCheck["trap"], string> = {
  WATER_STAIN:
    "Water stain: are the washed-out characters truly unreadable (no ghost of the digit)? Only a recorded Claude read can show the trap holds; you can record that it fails.",
  MARGIN_NOTE:
    "Margin note: is it fully outside every box and readable as written? Only a recorded Claude read can show it is quarantined; you can record that it fails.",
};

/** The review page's items for a fixture: every value-bearing field, then the behavioural traps. */
export function reviewItems(f: Fixture): { fields: ReviewItem[]; traps: TrapItem[] } {
  const fields: ReviewItem[] = [];
  const traps: TrapItem[] = [];
  const push = (path: string, title: string, ff: FieldFixture) =>
    fields.push({
      i: fields.length,
      path,
      title,
      rect: { x1: ff.x1, y1: ff.y1, x2: ff.x2, y2: ff.y2 },
      value: ff.value,
      requested: ff.requested,
      visible: ff.visible,
      legibility: ff.legibility,
      expect: ff.expect,
      checkedBy: ff.checkedBy,
    });
  if (f.kind === "slip_page" || f.kind === "slip_photo") {
    const sf = f as SlipImageFixture;
    for (const s of sf.slips) {
      for (const e of slipFieldEntries(s)) {
        const path = sf.kind === "slip_page" ? e.path : `${s.slot}.${e.path}`;
        push(
          path,
          `${s.slot === "ONLY" ? "" : `${s.slot} · `}slip ${s.serial} · ${slipTitle(e.path)}`,
          e.field,
        );
      }
      for (const t of s.trapChecks) {
        traps.push({
          slot: s.slot,
          trap: t.trap,
          status: t.status,
          by: t.by,
          evidence: t.evidence,
          question: TRAP_QUESTIONS[t.trap],
        });
      }
    }
  } else if (f.kind === "logbook_page") {
    for (const [path, ff] of fixtureFields(f as LogbookPageFixture)) push(path, path.replace(".", " · "), ff);
  }
  return { fields, traps };
}

export const ReviewSubmission = z.object({
  fields: z.array(
    z.object({
      path: z.string(),
      visible: z.string(),
      legibility: z.enum(LEGIBILITY),
      expect: Expect,
      cropWrong: z.boolean().default(false),
    }),
  ),
  traps: z
    .array(
      z.object({
        slot: z.enum(SLOTS),
        trap: z.enum(["WATER_STAIN", "MARGIN_NOTE"]),
        /** A person can record that a trap fails, or that it renders and still needs a read. */
        status: z.enum(["UNVERIFIED", "FAILED"]),
        evidence: z.string().default(""),
      }),
    )
    .default([]),
  note: z.string().default(""),
});
export type ReviewSubmission = z.input<typeof ReviewSubmission>;

export interface SessionRecord {
  v: 1;
  fixture: string;
  imageSha256: string;
  reviewer: string;
  startedAt: string;
  submittedAt: string;
  fields: z.output<typeof ReviewSubmission>["fields"];
  traps: z.output<typeof ReviewSubmission>["traps"];
  note: string;
  /** Set when the person confirmed `human-reviewed` at the terminal. */
  confirmedAt: string | null;
}

export class SubmissionError extends Error {}

/** Where a session is kept, relative to the media root: `review/sessions/{fixture}.{yyyymmddThhmmss}.json`. */
export function sessionPath(fixtureId: string, submittedAt: string): string {
  return `review/sessions/${fixtureId}.${submittedAt.replace(/[-:]/g, "").slice(0, 15)}.json`;
}

/**
 * Applies a complete submission to the fixture (every field must be answered). Fields become
 * `checkedBy: "human"`; wrong crops send the fixture back to draft. The fixture is not marked
 * human-reviewed here: that needs the person's confirmation at the terminal.
 */
export function applySubmission(
  f: Fixture,
  input: ReviewSubmission,
  meta: { reviewer: string; startedAt: string; submittedAt: string },
): SessionRecord {
  const sub = ReviewSubmission.parse(input);
  const fields = fixtureFields(f);
  const answered = new Map(sub.fields.map((x) => [x.path, x]));
  const missing = [...fields.keys()].filter((p) => !answered.has(p));
  const unknown = sub.fields.filter((x) => !fields.has(x.path)).map((x) => x.path);
  if (missing.length || unknown.length) {
    throw new SubmissionError(
      [
        missing.length ? `unanswered: ${missing.join(", ")}` : "",
        unknown.length ? `unknown: ${unknown.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  for (const [path, field] of fields) {
    const a = answered.get(path);
    if (!a) continue;
    field.visible = a.visible;
    field.legibility = a.legibility;
    field.expect = a.expect;
    field.checkedBy = "human";
  }
  if (f.kind === "slip_page" || f.kind === "slip_photo") {
    for (const t of sub.traps) {
      const check = (f as SlipImageFixture).slips
        .find((s) => s.slot === t.slot)
        ?.trapChecks.find((c) => c.trap === t.trap);
      if (!check) throw new SubmissionError(`no ${t.trap} trap on slot ${t.slot}`);
      // A read's verdict (by: "read") is never overwritten by a look.
      if (check.by === "read") continue;
      if (t.status === "FAILED") {
        Object.assign(check, {
          status: "FAILED",
          by: "human",
          at: meta.submittedAt,
          evidence: t.evidence || "a person could read it",
        });
      } else if (check.status === "FAILED") {
        // The person saw the trap render as intended: their look outranks an earlier look, so it waits for a
        // recorded read again, and the evidence says who overruled whom.
        Object.assign(check, {
          status: "UNVERIFIED",
          by: null,
          at: null,
          evidence: `${t.evidence || "renders as intended"} (${meta.reviewer}, ${meta.submittedAt}, overruling the earlier ${check.by} look: ${check.evidence})`,
        });
      } else if (t.evidence) {
        check.evidence = t.evidence;
      }
    }
  }
  const crops = sub.fields.filter((x) => x.cropWrong).map((x) => x.path);
  f.review.cropIssues = crops;
  if (crops.length) f.review.status = "draft";
  if (sub.note) f.review.notes.push(`Review note (${meta.reviewer}, ${meta.submittedAt}): ${sub.note}`);
  return {
    v: 1,
    fixture: f.id,
    imageSha256: f.image.sha256,
    reviewer: meta.reviewer,
    startedAt: meta.startedAt,
    submittedAt: meta.submittedAt,
    fields: sub.fields,
    traps: sub.traps,
    note: sub.note,
    confirmedAt: null,
  };
}

/** Why a fixture cannot be marked human-reviewed (empty when it can). */
export function humanReviewBlockers(f: Fixture): string[] {
  const out: string[] = [];
  if (f.review.cropIssues.length) out.push(`wrong crops to redraft first: ${f.review.cropIssues.join(", ")}`);
  const notHuman = [...fixtureFields(f)].filter(([, x]) => x.checkedBy !== "human").map(([p]) => p);
  if (notHuman.length)
    out.push(
      `${notHuman.length} field(s) not checked by a person in \`imagegen review\` (first: ${notHuman.slice(0, 3).join(", ")})`,
    );
  return out;
}

/** Why a fixture's image cannot join a replay set yet (empty when it can): A–L acceptance (S4.10). */
export function replayBlockers(f: Fixture): string[] {
  const out: string[] = [];
  if (f.review.status !== "human-reviewed") out.push(`fixture is ${f.review.status}, not human-reviewed`);
  if (f.kind === "slip_page" || f.kind === "slip_photo") {
    for (const s of (f as SlipImageFixture).slips) {
      for (const t of s.trapChecks) {
        if (t.status !== "HOLDS" || t.by !== "read") {
          out.push(
            `${s.slot} slip ${s.serial}: ${t.trap} must be shown to hold by a recorded Claude read (now ${t.status}${t.by ? ` by ${t.by}` : ""})`,
          );
        }
      }
    }
  }
  return out;
}
