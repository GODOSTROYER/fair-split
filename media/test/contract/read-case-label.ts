import { z } from "zod";

/**
 * The consumer's side of the IC-11 label contract: WS-READ's eval loader (`packages/eval/src/labels.ts` and
 * `src/cases.ts` on ws/read at 5e39c9f, with `COPIES` and `ROW_FIELDS` from `packages/ai/src/read/schema.ts`),
 * copied here key for key so media's tests parse every label exactly as READ will. Every object is strict:
 * a key READ does not know fails the whole file, as `v`, `synthetic` and `status` did in the first labels.
 * When READ adopts media's schema in place of its shim, this copy follows it in the same change.
 */

const COPIES = ["WHITE_ORIGINAL", "PINK_DUPLICATE", "YELLOW_TRIPLICATE", "LOGBOOK_LINE", "UNKNOWN"] as const;

const ROW_FIELDS = [
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

const Expect = z.enum(["AUTO", "HUMAN", "EITHER"]);

const FieldLabel = z.strictObject({ value: z.string(), visible: z.string(), expect: Expect });

const TRAPS = [
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

export const ReadSlipLabel = z.strictObject({
  slot: z.string(),
  serial: z.string(),
  copy: z.enum(COPIES),
  fields: z.partialRecord(z.enum(ROW_FIELDS), FieldLabel),
  deductions: z.array(z.strictObject({ visible: z.string(), rule: z.string(), expect: Expect })).default([]),
  traps: z.array(z.enum(TRAPS)).default([]),
  duplicate_of: z.string().nullable().default(null),
  injection: z
    .strictObject({ lang: z.enum(["en", "fil", "ceb"]), text: z.string() })
    .nullable()
    .default(null),
});

const TypedValueLabel = z.union([
  z.strictObject({ unit: z.literal("none") }),
  z.strictObject({
    unit: z.enum(["bp", "centavos", "cents", "centavos_per_kg", "tenths_kg_per_tree"]),
    value: z.int(),
  }),
]);

const TermLabel = z.strictObject({
  rule_id: z.string(),
  pool: z.enum(["PREMIUM", "BONUS", "NONE"]),
  basis: z.string(),
  value: TypedValueLabel,
  cap: TypedValueLabel,
});

export const ReadCaseLabel = z.strictObject({
  case: z.string(),
  set: z.enum(["test", "dev"]),
  kind: z.enum(["slip_photo", "slip_page", "logbook_page", "rate_card_page"]),
  image: z.string(),
  fixture: z.string().nullable().default(null),
  slips: z.array(ReadSlipLabel).default([]),
  rate_card: z
    .strictObject({
      pages: z.array(z.string()),
      text_layer: z.string(),
      terms: z.array(TermLabel),
      amendment_present: z.boolean(),
    })
    .nullable()
    .default(null),
  reviewer: z.string(),
  reviewed_at: z.string(),
});
export type ReadCaseLabel = z.infer<typeof ReadCaseLabel>;

/** READ's `loadCases`: every `*.json` of one folder, filtered to a set; a file that fails the schema is kept as invalid. */
export function loadLikeRead(
  files: ReadonlyArray<{ file: string; json: unknown }>,
  set: "test" | "dev",
): { cases: ReadCaseLabel[]; invalid: Array<{ file: string; error: string }> } {
  const cases: ReadCaseLabel[] = [];
  const invalid: Array<{ file: string; error: string }> = [];
  for (const { file, json } of files) {
    const parsed = ReadCaseLabel.safeParse(json);
    if (!parsed.success) invalid.push({ file, error: parsed.error.message });
    else if (parsed.data.set === set) cases.push(parsed.data);
  }
  return { cases, invalid };
}
