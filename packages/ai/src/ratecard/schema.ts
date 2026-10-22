import { z } from "zod";
import { Box } from "../read/schema.js";

/**
 * AI-5 `RateCardRead` (S4.3). The model writes no typed number: every value is a verbatim string
 * that code re-parses (`parse.ts`), and every quote is checked against the human-verified text layer
 * (`check.ts`). Bump the version whenever the shape changes.
 */
export const RATECARD_SCHEMA_V = "ratecard.v1";

export const TERM_KINDS = ["SHARE", "DEDUCTION", "COSIGN", "TOLERANCE", "CLOSED_LIST"] as const;
export const POOLS = ["PREMIUM", "BONUS", "NONE"] as const;
export const BASES = [
  "VERIFIED_KG",
  "VERIFIED_G1_KG",
  "PCT_OF_BONUS",
  "PER_NET_KG",
  "BATCH_TOTAL",
  "LINE_TOTAL",
  "OVERRIDE",
  "MASS_BALANCE",
  "KG_PER_TREE",
  "READ_CONFIDENCE",
  "NONE",
] as const;
export type Basis = (typeof BASES)[number];
export const REQUIRED_DOCUMENTS = ["NONE", "AUTHORITY_TO_DEDUCT", "VOUCHER"] as const;
export type RequiredDocument = (typeof REQUIRED_DOCUMENTS)[number];

export const Term = z.strictObject({
  rule_id: z.string(), // as printed: R0..R6, CLOSED
  kind: z.enum(TERM_KINDS),
  pool: z.enum(POOLS),
  basis: z.enum(BASES),
  value_as_written: z.string(),
  cap_as_written: z.string(),
  condition_as_written: z.string(),
  requires_document: z.enum(REQUIRED_DOCUMENTS),
  source: z.strictObject({ page: z.int(), box: Box, quote: z.string() }),
});
export type Term = z.infer<typeof Term>;

export const RateCardRead = z.strictObject({
  resolution_no: z.string(),
  ratified_on_as_written: z.string(),
  terms: z.array(Term),
  signatories: z.array(
    z.strictObject({
      role: z.enum(["SECRETARY", "CHAIR", "DIRECTOR", "BUYER"]),
      name_as_written: z.string(),
      signed: z.enum(["YES", "NO", "UNCLEAR"]),
    }),
  ),
  anomalies: z.array(
    z.strictObject({
      kind: z.enum(["INSTRUCTION_LIKE_TEXT", "HANDWRITTEN_AMENDMENT", "OTHER"]),
      page: z.int(),
      box: Box,
      verbatim: z.string(),
    }),
  ),
});
export type RateCardRead = z.infer<typeof RateCardRead>;

/** IC-11 sidecar `media/docs/{doc}.text.json`: human-verified page text standing in for an OCR layer. */
export interface TextLayer {
  document: string;
  pages: Array<{ page: number; text: string }>;
  verified_by?: string;
  verified_at?: string;
}
