import { z } from "zod";
import { COPY_COLOURS } from "../template/slip-template.js";

/**
 * Reviewed crop fixtures (IC-11: `media/fixtures/{photo}.json`): for each image, every slip's number,
 * copy colour, corner quad and one rectangle per field. Rectangles are normalised to 0–1 of the image as
 * stored in `image.master` (S4 deviation 12), origin top-left, so they apply unchanged to the display
 * WebP. Fixtures are the only source of crops (C-10); model boxes never are.
 *
 * Field names are the extraction `Row` schema's (S4.2): the scalar fields keep their names, box 13's two
 * Kaltas lines are `deductions[0]` and `deductions[1]` (the template's `deduction_1` and `deduction_2`),
 * and the signature box is `signature`. A field is its rectangle (`x1, y1, x2, y2`, so a consumer that
 * only wants rectangles can read `fields[name]` as one) plus what is written in it.
 *
 * Labels are what is visibly written (C-24). A drafted fixture only knows what the prompt asked for, so
 * every field starts `UNVERIFIED` with `visible` = `requested`; only a recorded check (an agent's visual
 * check through `imagegen apply-review`, or a person through `imagegen review`) sets what is actually
 * visible. A fixture moves `draft → agent-checked → human-reviewed`, and only a person, at an interactive
 * terminal, can set `human-reviewed` (register §11 "Checking image labels"). Consumers show anything less
 * as pending review.
 */

export const FIXTURE_VERSION = 2;

const RectShape = {
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
};
const rectOk = (r: { x1: number; y1: number; x2: number; y2: number }) => r.x2 > r.x1 && r.y2 > r.y1;
const RECT_MESSAGE = { message: "rectangle must have x2 > x1 and y2 > y1" };

export const NRect = z.object(RectShape).refine(rectOk, RECT_MESSAGE);
export type NRect = z.infer<typeof NRect>;

const NPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

/** Slip corners, normalised: top-left, top-right, bottom-right, bottom-left. */
export const NQuad = z.tuple([NPoint, NPoint, NPoint, NPoint]);

/** S4.2's legibility values, plus UNVERIFIED: no recorded check has looked at the field yet. */
export const LEGIBILITY = ["CLEAR", "SMUDGED", "OVERWRITTEN", "ILLEGIBLE", "ABSENT"] as const;
export const FixtureLegibility = z.enum([...LEGIBILITY, "UNVERIFIED"]);
export type FixtureLegibility = z.infer<typeof FixtureLegibility>;

/** What a reader should do with a field (S4.10 labels): auto-accept, route to a person, or either. */
export const Expect = z.enum(["AUTO", "HUMAN", "EITHER"]);
export type Expect = z.infer<typeof Expect>;

/** Who recorded what is visible: an agent's visual check, or a person in the review tool. */
export const CheckedBy = z.enum(["agent", "human"]);
export type CheckedBy = z.infer<typeof CheckedBy>;

const FieldShape = {
  ...RectShape,
  /** The truth the content spec records (the seed's value). */
  value: z.string(),
  /** What the prompt asked to be visible: the value, or a stain pattern with "?" per washed-out character. */
  requested: z.string(),
  /** What is visibly written, "?" for each unreadable character. Equals `requested` while UNVERIFIED. */
  visible: z.string(),
  legibility: FixtureLegibility,
  expect: Expect,
  checkedBy: CheckedBy.nullable(),
};

function fieldOk(f: {
  legibility: FixtureLegibility;
  checkedBy: CheckedBy | null;
  visible: string;
  requested: string;
}) {
  return f.legibility === "UNVERIFIED"
    ? f.checkedBy === null && f.visible === f.requested
    : f.checkedBy !== null;
}
const FIELD_MESSAGE = {
  message: "UNVERIFIED fields have no checker and show what was requested; checked fields name their checker",
};

export const FieldFixture = z.object(FieldShape).refine(rectOk, RECT_MESSAGE).refine(fieldOk, FIELD_MESSAGE);
export type FieldFixture = z.infer<typeof FieldFixture>;

/** Row fields a printed slip has (S4.2 `Row` scalars; `line_no` belongs to logbook lines). */
export const SLIP_ROW_FIELDS = [
  "serial",
  "date",
  "member_no",
  "member_name",
  "plot_no",
  "sacks",
  "gross_kg",
  "tare_kg",
  "net_kg",
  "mc_pct",
  "mc_less_kg",
  "payable_kg",
  "grade",
  "clerk_initials",
] as const;
export type SlipRowField = (typeof SLIP_ROW_FIELDS)[number];

/** What the image shows beyond ruled handwriting; each needs its own check. */
export const ARTIFACT_TRAPS = ["WATER_STAIN", "MARGIN_NOTE", "CARBON_COPY", "DEDUCTION_MARKS"] as const;
export type ArtifactTrap = (typeof ARTIFACT_TRAPS)[number];

/** Traps whose behaviour (not just their look) must be shown by a real read before a replay photo is used. */
export const BEHAVIOURAL_TRAPS = ["WATER_STAIN", "MARGIN_NOTE"] as const satisfies readonly ArtifactTrap[];

/**
 * Whether a trap does what the story needs. WATER_STAIN holds when the stained characters cannot be read
 * and both Claude reads score the field below 0.85 (so it goes to a person, C-17); MARGIN_NOTE holds when
 * the note is read as instruction-like text and quarantined (C-16). `by: "read"` means a recorded A/B read
 * showed it; an agent's or a person's look can only show that the trap renders, or that it failed.
 */
export const TrapCheck = z
  .object({
    trap: z.enum(BEHAVIOURAL_TRAPS),
    status: z.enum(["UNVERIFIED", "HOLDS", "FAILED"]),
    by: z.enum(["agent", "human", "read"]).nullable(),
    at: z.string().nullable(),
    /** For people: what was seen, or for a read the report, its sha256 prefix and what it scored. */
    evidence: z.string(),
    /**
     * A recorded read only (`by: "read"`): the WS-READ eval report the verdict rests on, repo-relative
     * (`packages/eval/report/…`), and its sha256 when the verdict was recorded. `replay-check` re-reads the
     * file and re-runs the verdict's checks on it (review/evidence.ts), so a verdict is never taken on trust.
     */
    evidenceFile: z.string().min(1).optional(),
    evidenceSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /**
     * WATER_STAIN only: the user's recorded decision that it is acceptable for other boxes to give the
     * stained value away (review/stain.ts; slip 0462's box 11). Without it a leaking stain never holds.
     */
    leakAccepted: z.string().min(1).optional(),
  })
  .refine((t) => (t.status === "UNVERIFIED") === (t.by === null), {
    message: "an UNVERIFIED trap has no checker; a checked one names it",
  })
  .refine((t) => t.leakAccepted === undefined || t.trap === "WATER_STAIN", {
    message: "only a WATER_STAIN check records a decision about a leaking stain",
  })
  .refine((t) => t.status !== "HOLDS" || t.by === "read", {
    message: "only a recorded read can show that a trap holds; a look can show only that it failed",
  })
  .refine((t) => t.by !== "read" || (t.evidenceFile !== undefined && t.evidenceSha256 !== undefined), {
    message:
      "a recorded read names the report it rests on and that report's sha256 (evidenceFile, evidenceSha256); record it with imagegen trap-verdict",
  })
  .refine((t) => t.by === "read" || (t.evidenceFile === undefined && t.evidenceSha256 === undefined), {
    message:
      "only a recorded read pins a report (evidenceFile, evidenceSha256); a look says what it saw in evidence",
  });
export type TrapCheck = z.infer<typeof TrapCheck>;

/** Text on the paper outside the boxes, such as slip 0449's note: the box the sanitiser hatches (S4.2). */
export const AnomalyFixture = z
  .object({ kind: z.literal("INSTRUCTION_LIKE_TEXT"), ...FieldShape })
  .refine(rectOk, RECT_MESSAGE)
  .refine(fieldOk, FIELD_MESSAGE);
export type AnomalyFixture = z.infer<typeof AnomalyFixture>;

export const SLOTS = ["TL", "TR", "BL", "BR", "ONLY"] as const;
export type Slot = (typeof SLOTS)[number];

export const SlipFixture = z
  .object({
    /** TL/TR/BL/BR on a four-slip photo; ONLY on a one-slip page. */
    slot: z.enum(SLOTS),
    serial: z.string().regex(/^\d{4}$/),
    copy: z.enum(COPY_COLOURS),
    quad: NQuad,
    /** Bounding rectangle of the quad. */
    rect: NRect,
    fields: z.object(
      Object.fromEntries(SLIP_ROW_FIELDS.map((f) => [f, FieldFixture])) as Record<
        SlipRowField,
        typeof FieldFixture
      >,
    ),
    /** Box 13 (Kaltas): line 1 then line 2, blank lines included. */
    deductions: z.tuple([FieldFixture, FieldFixture]),
    /** The signature-or-thumbmark box; `value` is SIGNED or THUMBMARK. */
    signature: FieldFixture,
    anomalies: z.array(AnomalyFixture),
    traps: z.array(z.enum(ARTIFACT_TRAPS)),
    trapChecks: z.array(TrapCheck),
    /**
     * `{fixture id}#{slot}` of the white original when this slip is a carbon copy of it in the same group
     * (S4.10 `duplicate_of`: only the duplicate points, never the original, never across groups).
     */
    duplicateOf: z
      .string()
      .regex(/^[\w-]+#(?:TL|TR|BL|BR|ONLY)$/)
      .nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.copy === "WHITE_ORIGINAL" && s.duplicateOf !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["duplicateOf"],
        message: "a WHITE_ORIGINAL is never a duplicate",
      });
    }
    for (const t of BEHAVIOURAL_TRAPS) {
      if (s.traps.includes(t) !== s.trapChecks.some((c) => c.trap === t)) {
        ctx.addIssue({ code: "custom", path: ["trapChecks"], message: `${t} needs exactly one trap check` });
      }
    }
  });
export type SlipFixture = z.infer<typeof SlipFixture>;

export const ImageRef = z.object({
  master: z.string(),
  display: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** A review session file, relative to the media root: what `review.session` holds. */
export const SESSION_FILE = /^review\/sessions\/[\w.-]+\.json$/;

export const FixtureReview = z
  .object({
    status: z.enum(["draft", "agent-checked", "human-reviewed"]),
    /** How rectangles were made and checked, e.g. "grid-detect v1 (ruled lines snapped), visual check". */
    method: z.string(),
    reviewer: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    notes: z.array(z.string()),
    /** Fields whose crop a reviewer marked wrong; they must be redrafted before the fixture is reviewed. */
    cropIssues: z.array(z.string()),
    /**
     * The saved review session (`review/sessions/{id}.{stamp}.json`, relative to the media root) whose
     * readings a person confirmed at the terminal; set with `human-reviewed`, cleared when new readings
     * or a redraft replace them. `reviewProof` checks that it exists, was confirmed, and is of this image
     * by this reviewer with these readings: the terminal gate guards against accidents, the record is
     * what can be checked.
     */
    session: z.string().regex(SESSION_FILE).nullable().default(null),
  })
  .refine((r) => r.status === "draft" || r.cropIssues.length === 0, {
    message: "a fixture with wrong crops stays a draft until they are redrafted",
    path: ["cropIssues"],
  })
  .refine((r) => r.status !== "human-reviewed" || r.session !== null, {
    message: "a human-reviewed fixture names the review session a person confirmed",
    path: ["session"],
  });
export type FixtureReview = z.infer<typeof FixtureReview>;

const Base = {
  v: z.literal(FIXTURE_VERSION),
  id: z.string().min(1),
  /** The group of images read or replayed together (duplicates are keyed within it; see content/types.ts). */
  group: z.string().min(1),
  /** I8: every fixture describes a synthetic image. */
  synthetic: z.literal(true),
  image: ImageRef,
  review: FixtureReview,
};

/** Every value-bearing field of a slip, with a path for messages and review records. */
export function slipFieldEntries(s: SlipFixture): { path: string; field: FieldFixture }[] {
  return [
    ...SLIP_ROW_FIELDS.map((f) => ({ path: `fields.${f}`, field: s.fields[f] as FieldFixture })),
    ...s.deductions.map((d, i) => ({ path: `deductions.${i}`, field: d })),
    { path: "signature", field: s.signature },
    ...s.anomalies.map((a, i) => ({ path: `anomalies.${i}`, field: a as FieldFixture })),
  ];
}

/** Checks that the review status agrees with the fields: no UNVERIFIED once checked, all human once reviewed. */
function reviewAgrees(
  status: FixtureReview["status"],
  fields: readonly { path: string; field: { legibility: FixtureLegibility; checkedBy: CheckedBy | null } }[],
  ctx: z.RefinementCtx,
): void {
  if (status === "draft") return;
  const open = fields.filter((f) => f.field.legibility === "UNVERIFIED").map((f) => f.path);
  if (open.length) {
    ctx.addIssue({
      code: "custom",
      path: ["review", "status"],
      message: `${status} with unverified fields: ${open.slice(0, 5).join(", ")}`,
    });
  }
  if (status === "human-reviewed") {
    const notHuman = fields.filter((f) => f.field.checkedBy !== "human").map((f) => f.path);
    if (notHuman.length) {
      ctx.addIssue({
        code: "custom",
        path: ["review", "status"],
        message: `human-reviewed with fields a person has not checked: ${notHuman.slice(0, 5).join(", ")}`,
      });
    }
  }
}

export const SlipImageFixture = z
  .object({
    ...Base,
    kind: z.enum(["slip_photo", "slip_page"]),
    template: z.literal("slip-v1"),
    slips: z.array(SlipFixture).min(1).max(4),
  })
  .superRefine((f, ctx) => {
    if (f.kind === "slip_page" && (f.slips.length !== 1 || f.slips[0]?.slot !== "ONLY")) {
      ctx.addIssue({
        code: "custom",
        path: ["slips"],
        message: "a slip_page fixture holds exactly one ONLY slip",
      });
    }
    if (f.kind === "slip_photo") {
      const pos = f.slips.map((s) => s.slot).sort();
      if (pos.join() !== "BL,BR,TL,TR")
        ctx.addIssue({ code: "custom", path: ["slips"], message: "a slip_photo has TL, TR, BL and BR" });
    }
    reviewAgrees(
      f.review.status,
      f.slips.flatMap((s) => slipFieldEntries(s).map((e) => ({ ...e, path: `${s.slot}.${e.path}` }))),
      ctx,
    );
  });
export type SlipImageFixture = z.infer<typeof SlipImageFixture>;

/** A Schedule A clause on a BR 2026-04 page: the hover target on W-TR-02 and AI-5's source box. */
export const ClauseFixture = z.object({
  id: z.string(),
  rect: NRect,
  text: z.string(),
});

export const RateCardPageFixture = z.object({
  ...Base,
  kind: z.literal("rate_card_page"),
  page: z.number().int().positive(),
  textLayer: z.string(),
  blocks: z.array(ClauseFixture).min(1),
});
export type RateCardPageFixture = z.infer<typeof RateCardPageFixture>;

export const LOGBOOK_COLUMNS = [
  "line",
  "date",
  "serial",
  "member_no",
  "member_name",
  "net_kg",
  "grade",
  "remarks",
] as const;
export type LogbookColumn = (typeof LOGBOOK_COLUMNS)[number];

export const LogbookLineFixture = z.object({
  line: z.number().int().positive(),
  rect: NRect,
  serial: z.string(),
  cells: z.object(
    Object.fromEntries(LOGBOOK_COLUMNS.map((c) => [c, FieldFixture])) as Record<
      LogbookColumn,
      typeof FieldFixture
    >,
  ),
});
export type LogbookLineFixture = z.infer<typeof LogbookLineFixture>;

export const LogbookPageFixture = z
  .object({
    ...Base,
    kind: z.literal("logbook_page"),
    page: z.number().int().positive(),
    columns: z.array(z.enum(LOGBOOK_COLUMNS)).min(1),
    lines: z.array(LogbookLineFixture),
  })
  .superRefine((f, ctx) =>
    reviewAgrees(
      f.review.status,
      f.lines.flatMap((l) =>
        LOGBOOK_COLUMNS.map((c) => ({ path: `line ${l.line}.${c}`, field: l.cells[c] })),
      ),
      ctx,
    ),
  );
export type LogbookPageFixture = z.infer<typeof LogbookPageFixture>;

export const Fixture = z.union([SlipImageFixture, RateCardPageFixture, LogbookPageFixture]);
export type Fixture = z.infer<typeof Fixture>;

/** JSON Schema for non-TypeScript consumers, written to media/fixtures/fixture.schema.json. */
export function fixtureJsonSchema(): unknown {
  return z.toJSONSchema(Fixture, { unrepresentable: "any", io: "input" });
}
