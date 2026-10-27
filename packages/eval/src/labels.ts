// TEMPORARY SHIM: replace with the IC-11 label schema once WS-MEDIA's review tool writes
// `media/eval/labels/{case}.json` (S4.10 "Review and labels": value, visible, expect, traps,
// duplicate_of, reviewer, time). A label is what is visibly written on the image, checked by a
// person (C-24); `visible` is the truth every metric scores against.
import { COPIES, ROW_FIELDS } from "@fairsplit/ai/read";
import { z } from "zod";

export const Expect = z.enum(["AUTO", "HUMAN", "EITHER"]);
export type Expect = z.infer<typeof Expect>;

export const FieldLabel = z.strictObject({
  /** What the generation prompt asked for. */
  value: z.string(),
  /** What is visibly written: the truth. */
  visible: z.string(),
  expect: Expect,
});
export type FieldLabel = z.infer<typeof FieldLabel>;

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

export const SlipLabel = z.strictObject({
  /** Position: TL/TR/BL/BR on a photo, ONLY on a page, or the logbook line number. */
  slot: z.string(),
  serial: z.string(),
  copy: z.enum(COPIES),
  fields: z.partialRecord(z.enum(ROW_FIELDS), FieldLabel),
  deductions: z
    .array(
      z.strictObject({
        visible: z.string(),
        /** The ratified rule id the line is an instance of, or NO_MATCH. */
        rule: z.string(),
        expect: Expect,
      }),
    )
    .default([]),
  traps: z.array(z.enum(TRAPS)).default([]),
  /** `{case}#{slot}` of the other copy when this slip is one half of a duplicate pair. */
  duplicate_of: z.string().nullable().default(null),
  injection: z
    .strictObject({ lang: z.enum(["en", "fil", "ceb"]), text: z.string() })
    .nullable()
    .default(null),
});
export type SlipLabel = z.infer<typeof SlipLabel>;

const TypedValueLabel = z.union([
  z.strictObject({ unit: z.literal("none") }),
  z.strictObject({
    unit: z.enum(["bp", "centavos", "cents", "centavos_per_kg", "tenths_kg_per_tree"]),
    value: z.int(),
  }),
]);

export const TermLabel = z.strictObject({
  rule_id: z.string(),
  pool: z.enum(["PREMIUM", "BONUS", "NONE"]),
  basis: z.string(),
  value: TypedValueLabel,
  cap: TypedValueLabel,
});
export type TermLabel = z.infer<typeof TermLabel>;

export const CaseLabel = z.strictObject({
  case: z.string(),
  set: z.enum(["test", "dev"]),
  kind: z.enum(["slip_photo", "slip_page", "logbook_page", "rate_card_page"]),
  /** Image path relative to the media root (rate cards: the first page). */
  image: z.string(),
  /** `media/fixtures/{photo}.json`, relative to the media root. */
  fixture: z.string().nullable().default(null),
  slips: z.array(SlipLabel).default([]),
  rate_card: z
    .strictObject({
      pages: z.array(z.string()),
      text_layer: z.string(),
      terms: z.array(TermLabel),
      /** A handwritten amendment is on the page and must not become a term. */
      amendment_present: z.boolean(),
    })
    .nullable()
    .default(null),
  reviewer: z.string(),
  reviewed_at: z.string(),
});
export type CaseLabel = z.infer<typeof CaseLabel>;

/** The id of a labelled slip, as used by `duplicate_of`. */
export const slipId = (caseId: string, slot: string): string => `${caseId}#${slot}`;
