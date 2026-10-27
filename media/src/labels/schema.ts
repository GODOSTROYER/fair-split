import { z } from "zod";

/**
 * Eval labels (IC-11; S4.10 "Labels": value, visible, expect, traps, duplicate_of, reviewer, time). A label is
 * what is visibly written on the image (C-24): `visible` is the truth every metric scores against, `value` is
 * the seed's value (they differ only where the image deviates, such as 0462's stain). Labels are derived from
 * checked fixtures by `imagegen labels`; nobody edits them by hand. Field names follow the extraction `Row`
 * schema (S4.2).
 *
 * The shape is exactly the one WS-READ's `packages/eval` loader parses strictly (`src/labels.ts`): the same
 * keys and no others, so every label written here loads there unchanged (`test/contract.ic11-labels.test.ts`).
 * What a label does not carry lives beside it:
 * - **Review status: the folder.** Only a label a person checked (`human-reviewed`, C-24) is written to
 *   `eval/labels/`, the folder the eval loads by default. An `agent-checked` label is provisional and is
 *   written to `eval/provisional/`, so a run scores it only when it names that folder (`--labels`), and its
 *   report is then provisional. The fixture the label names (`fixture`) records the same `review.status`.
 * - **Synthetic: the fixture and the manifest.** Every case is a Codex image; its fixture and its manifest
 *   entry say `synthetic: true` (I8, `test/inv.i8.labels.test.ts`).
 * - **Version: the JSON Schema's `$id`** (`eval/label.schema.json`, {@link LABEL_SCHEMA_ID}).
 */

export const LABEL_VERSION = 1;
export const LABEL_SCHEMA_ID = `urn:fairsplit:ic-11:eval-label:v${LABEL_VERSION}`;

/** The fixture review states that produce a label; only `human-reviewed` labels are labels in C-24's sense. */
export const LABEL_STATUSES = ["agent-checked", "human-reviewed"] as const;
export type LabelStatus = (typeof LABEL_STATUSES)[number];

/** S4.2 `Row` scalar fields (in schema order). */
export const ROW_FIELDS = [
  "serial",
  "line_no",
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
export type RowField = (typeof ROW_FIELDS)[number];

export const LABEL_COPIES = [
  "WHITE_ORIGINAL",
  "PINK_DUPLICATE",
  "YELLOW_TRIPLICATE",
  "LOGBOOK_LINE",
] as const;

export const Expect = z.enum(["AUTO", "HUMAN", "EITHER"]);

/** What a case tests (S4.8's cells), in the eval's vocabulary. */
export const TRAPS = [
  "DUPLICATE",
  "NEAR_DUPLICATE",
  "NO_RULE",
  "RULED_DEDUCTION",
  "RATE_MISMATCH",
  "LOW_CONFIDENCE",
  "OVERWRITTEN",
  "ARITHMETIC",
  "INJECTION",
  "IMPLAUSIBLE_YIELD",
  "ROTATED",
  "BLURRED",
] as const;
export type Trap = (typeof TRAPS)[number];

export const FieldLabel = z.strictObject({
  /** The seed's value. */
  value: z.string(),
  /** What is visibly written: the truth the eval scores against. */
  visible: z.string(),
  expect: Expect,
});
export type FieldLabel = z.infer<typeof FieldLabel>;

export const SlipLabel = z.strictObject({
  /** TL/TR/BL/BR on a photo, ONLY on a one-slip page, the line number on a logbook page. */
  slot: z.string(),
  serial: z.string(),
  copy: z.enum(LABEL_COPIES),
  fields: z.partialRecord(z.enum(ROW_FIELDS), FieldLabel),
  /** Box 13's written lines (logbook remarks on a logbook page), with the rule each is an instance of. */
  deductions: z.array(z.strictObject({ visible: z.string(), rule: z.string(), expect: Expect })),
  traps: z.array(z.enum(TRAPS)),
  /** `{case}#{slot}` of the white original, only on its carbon copy in the same set. */
  duplicate_of: z.string().nullable(),
  injection: z.strictObject({ lang: z.enum(["en", "fil", "ceb"]), text: z.string() }).nullable(),
});
export type SlipLabel = z.infer<typeof SlipLabel>;

export const CaseLabel = z
  .strictObject({
    case: z.string().min(1),
    /** S4.8: `test` cases are never used for tuning; hero flats, photos and documents are `dev`. */
    set: z.enum(["test", "dev"]),
    kind: z.enum(["slip_photo", "slip_page", "logbook_page", "rate_card_page"]),
    /** The master the readers read, relative to the media root. */
    image: z.string(),
    /** `fixtures/{case}.json`, relative to the media root: rectangles, `synthetic` and `review.status`. */
    fixture: z.string().nullable(),
    slips: z.array(SlipLabel),
    rate_card: z.null(),
    reviewer: z.string(),
    reviewed_at: z.string(),
  })
  .superRefine((c, ctx) => {
    for (const [i, s] of c.slips.entries()) {
      if (s.copy === "WHITE_ORIGINAL" && s.duplicate_of !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["slips", i, "duplicate_of"],
          message: "a WHITE_ORIGINAL is never a duplicate",
        });
      }
      if (s.traps.includes("DUPLICATE") !== (s.duplicate_of !== null)) {
        ctx.addIssue({
          code: "custom",
          path: ["slips", i, "traps"],
          message: "DUPLICATE goes with duplicate_of, and only there",
        });
      }
    }
  });
export type CaseLabel = z.infer<typeof CaseLabel>;

/** `eval/label.schema.json`: the IC-11 label shape for consumers, with the version in its `$id`. */
export function labelJsonSchema(): Record<string, unknown> {
  const { $schema, ...shape } = z.toJSONSchema(CaseLabel, { unrepresentable: "any", io: "input" });
  return {
    $schema,
    $id: LABEL_SCHEMA_ID,
    title: `Fair Split eval label (IC-11), v${LABEL_VERSION}`,
    description:
      "One eval case: what is visibly written on a synthetic Codex image (C-24). eval/labels/{case}.json holds " +
      "person-checked labels (the scored truth); eval/provisional/{case}.json holds agent-checked ones, " +
      "provisional until a person reviews them. Review status and the synthetic flag live in the fixture.",
    ...shape,
  };
}
