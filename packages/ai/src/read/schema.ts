import { z } from "zod";

/**
 * The `Extraction` schema (S4.2, IC-07). Rules that make it safe and streamable:
 * - every property is required, so properties stream in schema order and each box arrives before
 *   its value;
 * - no unions; boxes are objects (structured outputs support no array-length constraints);
 * - there is no price, amount, total, payout, comment or instruction field (I1). Deduction lines and
 *   logbook remarks are verbatim strings.
 * Bump SCHEMA_V whenever the shape changes: recordings are keyed on it.
 */
export const EXTRACTION_SCHEMA_V = "extraction.v1";
export const ZOOM_SCHEMA_V = "zoomread.v1";

/** Pixels of the image as sent: x1,y1 top-left, x2,y2 bottom-right. */
export const Box = z.strictObject({ x1: z.int(), y1: z.int(), x2: z.int(), y2: z.int() });
export type Box = z.infer<typeof Box>;

export const LEGIBILITY = ["CLEAR", "SMUDGED", "OVERWRITTEN", "ILLEGIBLE", "ABSENT"] as const;
export const Leg = z.enum(LEGIBILITY);
export type Legibility = z.infer<typeof Leg>;

export const F = z.strictObject({
  box: Box,
  value_text: z.string(),
  legibility: Leg,
  overwritten_from: z.string(),
});
export type FieldRead = z.infer<typeof F>;

export const COPIES = [
  "WHITE_ORIGINAL",
  "PINK_DUPLICATE",
  "YELLOW_TRIPLICATE",
  "LOGBOOK_LINE",
  "UNKNOWN",
] as const;
export type CopyColour = (typeof COPIES)[number];

export const SIGNATURES = ["SIGNED", "THUMBMARK", "NONE", "UNCLEAR"] as const;

export const Row = z.strictObject({
  slip_box: Box,
  copy: z.enum(COPIES),
  serial: F,
  line_no: F,
  date: F,
  member_no: F,
  member_name: F,
  plot_no: F,
  sacks: F,
  gross_kg: F,
  tare_kg: F,
  net_kg: F,
  mc_pct: F,
  mc_less_kg: F,
  payable_kg: F,
  grade: F,
  clerk_initials: F,
  deductions: z.array(F), // box 13 / logbook remarks, one entry per line
  signature: z.enum(SIGNATURES),
});
export type Row = z.infer<typeof Row>;

export const ANOMALY_KINDS = ["INSTRUCTION_LIKE_TEXT", "ALTERED_VALUE", "UNKNOWN_MARK"] as const;
export const PAGE_ISSUES = ["BLUR", "GLARE", "CROPPED", "LOW_LIGHT", "SKEW"] as const;
export const ROTATIONS = ["0", "90", "180", "270"] as const;

export const Extraction = z.strictObject({
  page: z.strictObject({
    rotation: z.enum(ROTATIONS),
    issues: z.array(z.enum(PAGE_ISSUES)),
  }),
  rows: z.array(Row),
  anomalies: z.array(
    z.strictObject({
      kind: z.enum(ANOMALY_KINDS),
      box: Box,
      verbatim: z.string(),
    }),
  ),
});
export type Extraction = z.infer<typeof Extraction>;
export type Anomaly = Extraction["anomalies"][number];

/** AI-3: one field re-read on a tighter crop; the box is in crop coordinates. */
export const ZoomRead = F;
export type ZoomRead = FieldRead;

/** The scalar fields of a row, in schema (and therefore streaming) order. */
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

/** Names a model-produced number must never sit under (I1). Checked by `inv.i1.*` tests. */
export const FORBIDDEN_FIELD_WORDS = [
  "price",
  "amount",
  "total",
  "payout",
  "peso",
  "usd",
  "php",
  "cost",
  "fee",
  "comment",
  "instruction",
  "note",
  "share",
  "bonus",
  "premium",
] as const;
