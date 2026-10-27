import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  Expect,
  type FieldFixture,
  type Fixture,
  LEGIBILITY,
  type LogbookPageFixture,
  type NRect,
  SLOTS,
  type SlipFixture,
  type SlipImageFixture,
  slipFieldEntries,
  type TrapCheck,
} from "../fixtures/schema.js";
import { fixtureFields } from "../imagegen/review.js";
import { SLIP_BOXES } from "../template/slip-template.js";
import { describeLeaks, stainLeaks } from "./stain.js";

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
  /** What the slip's other boxes give away about a stained value (stain.ts), shown beside the question. */
  leak: string | null;
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

function leakNote(s: SlipFixture, t: TrapCheck): string | null {
  if (t.trap !== "WATER_STAIN") return null;
  const leaks = stainLeaks(s);
  if (!leaks.length) return null;
  return `Other boxes give the stained value away: ${describeLeaks(leaks)}.${t.leakAccepted ? ` Accepted: ${t.leakAccepted}.` : " Whether that is acceptable is the user's decision."}`;
}

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
          leak: leakNote(s, t),
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

/** A saved review session (`media/review/sessions/{fixture}.{stamp}.json`): one person's pass over one image. */
export const SessionRecord = z.object({
  v: z.literal(1),
  fixture: z.string().min(1),
  /** The image the person looked at: the fixture's master. */
  imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
  reviewer: z.string().min(1),
  startedAt: z.string(),
  submittedAt: z.string(),
  fields: ReviewSubmission.shape.fields,
  traps: z.array(ReviewSubmission.shape.traps.unwrap().element),
  note: z.string(),
  /** Set when the person confirmed `human-reviewed` at the terminal. */
  confirmedAt: z.string().nullable(),
});
export type SessionRecord = z.output<typeof SessionRecord>;

export class SubmissionError extends Error {}

const SESSIONS_DIR = "review/sessions";

/** Where a session is kept, relative to the media root: `review/sessions/{fixture}.{yyyymmddThhmmss}.json`. */
export function sessionPath(fixtureId: string, submittedAt: string): string {
  return `${SESSIONS_DIR}/${fixtureId}.${submittedAt.replace(/[-:]/g, "").slice(0, 15)}.json`;
}

/**
 * Why a saved session cannot stand behind the fixture's readings as `reviewer`'s review (empty when it
 * can): it must be a session of this fixture, of the same pixels, saved by that reviewer, and hold every
 * reading the fixture has, each checked by a person, with no crop marked wrong.
 */
export function sessionMismatches(f: Fixture, s: SessionRecord, reviewer: string): string[] {
  const out: string[] = [];
  if (s.fixture !== f.id) out.push(`it is a session of ${s.fixture}, not ${f.id}`);
  if (s.imageSha256 !== f.image.sha256) {
    out.push(
      `it reviewed other pixels (sha256 ${s.imageSha256.slice(0, 12)}…; the fixture's image is ${f.image.sha256.slice(0, 12)}…)`,
    );
  }
  if (s.reviewer.trim() !== reviewer.trim()) out.push(`it was saved by ${s.reviewer}, not ${reviewer}`);
  const answered = new Map(s.fields.map((x) => [x.path, x]));
  const differ: string[] = [];
  for (const [path, field] of fixtureFields(f)) {
    const a = answered.get(path);
    const same =
      a !== undefined &&
      field.checkedBy === "human" &&
      a.visible === field.visible &&
      a.legibility === field.legibility &&
      a.expect === field.expect;
    if (!same) differ.push(path);
  }
  if (differ.length) {
    out.push(`${differ.length} reading(s) differ from it (first: ${differ.slice(0, 3).join(", ")})`);
  }
  const wrong = s.fields.filter((x) => x.cropWrong).map((x) => x.path);
  if (wrong.length) out.push(`it marked crops wrong (${wrong.slice(0, 3).join(", ")})`);
  return out;
}

/** Reads and parses a saved session (`path` relative to the media root), or says why it cannot. */
export async function loadSession(mediaRoot: string, path: string): Promise<SessionRecord | string> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(mediaRoot, path), "utf8"));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT"
      ? `it names ${path}, which does not exist`
      : `${path} cannot be read: ${(e as Error).message}`;
  }
  const parsed = SessionRecord.safeParse(raw);
  return parsed.success
    ? parsed.data
    : `${path} is not a review session (${parsed.error.issues[0]?.message ?? "invalid"})`;
}

/**
 * Whether a person's review stands behind a `human-reviewed` fixture (empty when it does, or when nobody
 * claims one): the fixture names a saved session, confirmed at the terminal, of this image, by the
 * fixture's reviewer, holding exactly the fixture's readings. The terminal gate only guards against
 * accidents (an agent's pipe, CI); this record is what can be checked, so a hand-stamped or hand-edited
 * fixture shows up here, in `replay-check` and in `imagegen labels` (its label stays provisional).
 */
export async function reviewProof(mediaRoot: string, f: Fixture): Promise<string[]> {
  if (f.review.status !== "human-reviewed") return [];
  const path = f.review.session;
  if (!path) return ["it is human-reviewed but names no review session"];
  const s = await loadSession(mediaRoot, path);
  if (typeof s === "string") return [s];
  const out = sessionMismatches(f, s, f.review.reviewer ?? "").map(
    (m) => `review session ${path} does not match: ${m}`,
  );
  if (s.confirmedAt === null) out.push(`review session ${path} was never confirmed at the terminal`);
  return out;
}

/** The latest saved session by `reviewer` that holds the fixture's readings (for `imagegen mark`). */
export async function findConfirmableSession(
  mediaRoot: string,
  f: Fixture,
  reviewer: string,
): Promise<{ path: string; record: SessionRecord } | null> {
  let names: string[];
  try {
    names = await readdir(join(mediaRoot, SESSIONS_DIR));
  } catch {
    return null;
  }
  const found: { path: string; record: SessionRecord }[] = [];
  for (const name of names) {
    if (!name.startsWith(`${f.id}.`) || !name.endsWith(".json")) continue;
    const path = `${SESSIONS_DIR}/${name}`;
    const s = await loadSession(mediaRoot, path);
    if (typeof s !== "string" && sessionMismatches(f, s, reviewer).length === 0)
      found.push({ path, record: s });
  }
  found.sort((a, b) => b.record.submittedAt.localeCompare(a.record.submittedAt));
  return found[0] ?? null;
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
  // A confirmation covers the readings it confirmed: new readings wait for a new one at the terminal.
  else if (f.review.status === "human-reviewed") f.review.status = "agent-checked";
  f.review.session = null;
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

/**
 * Everything that stops an image from joining a replay set: {@link replayBlockers} plus the check that a
 * person's review really stands behind the fixture ({@link reviewProof}).
 */
export async function replayReadiness(mediaRoot: string, f: Fixture): Promise<string[]> {
  return [...replayBlockers(f), ...(await reviewProof(mediaRoot, f))];
}

/** Why a fixture's image cannot join a replay set yet (empty when it can): A–L acceptance (S4.10). */
export function replayBlockers(f: Fixture): string[] {
  const out: string[] = [];
  if (f.review.status !== "human-reviewed") out.push(`fixture is ${f.review.status}, not human-reviewed`);
  if (f.kind === "slip_page" || f.kind === "slip_photo") {
    for (const s of (f as SlipImageFixture).slips) {
      for (const t of s.trapChecks) {
        // A stain the slip's other boxes give away needs the user's decision as well as a read (stain.ts).
        const leaks = t.trap === "WATER_STAIN" ? stainLeaks(s) : [];
        const leak = leaks.length ? describeLeaks(leaks) : "";
        if (t.status !== "HOLDS" || t.by !== "read") {
          out.push(
            `${s.slot} slip ${s.serial}: ${t.trap} must be shown to hold by a recorded Claude read (now ${t.status}${t.by ? ` by ${t.by}` : ""})${leak && !t.leakAccepted ? `; the stain leaks: ${leak}, which needs the user's decision too` : ""}`,
          );
        } else if (leak && !t.leakAccepted) {
          out.push(
            `${s.slot} slip ${s.serial}: WATER_STAIN holds by a recorded read, but the stain leaks: ${leak}; it needs the user's decision that this is acceptable (trap-verdict --accept-leak)`,
          );
        }
      }
    }
  }
  return out;
}
