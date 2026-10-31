// The statement contract (plan "AI system › Statements", S1.11 "Statement plan", S4.5). Defined here, in the
// PROOF slice, until WS-CORE publishes `StatementPlan` in IC-01 (SPLIT.md "Gaps"): one plan serves the app,
// the 80 mm print, the audio manifest and Paminawa, and one pure `renderStatement` turns it into display,
// spoken and SMS text.
//
// I1: templates are words and {{PLACEHOLDERS}} only (no digit, no number word); every number a member reads is
// an integer fact (cents, centavos, grams, basis points) that code formats at render time.
import { Provenance } from "@fairsplit/contracts";
import { z } from "zod";

export const STATEMENT_SLOTS = [
  "GREETING",
  "DELIVERY",
  "PREMIUM",
  "BONUS",
  "DEDUCTION",
  "CREDIT",
  "PAY",
  "SOURCES",
  "HELP",
  "AI_NOTE",
] as const;
export const StatementSlot = z.enum(STATEMENT_SLOTS);
export type StatementSlot = z.infer<typeof StatementSlot>;

/** S1's placeholders plus RATE (plan amendment) and COOP (the SMS sender line). */
export const PLACEHOLDERS = [
  "HONORIFIC_NAME",
  "KG_TOTAL",
  "GRADE_SUMMARY",
  "PAYER",
  "PREMIUM_USD",
  "BONUS_USD",
  "DEDUCTION_USD",
  "RULE_LABEL",
  "RULE",
  "BR",
  "CREDIT_USD",
  "WRITTEN_PHP",
  "SLIP",
  "NET_USD",
  "NET_PHP",
  "FX_FEE",
  "CASH_DATE",
  "SLIPS",
  "TREASURER",
  "RATE",
  "COOP",
] as const;
export const Placeholder = z.enum(PLACEHOLDERS);
export type Placeholder = z.infer<typeof Placeholder>;

const Int = z.int();
const NonNeg = z.int().nonnegative();

/** Integer facts only: the renderer is the one place a number becomes text. */
export const Fact = z.discriminatedUnion("k", [
  z.strictObject({ k: z.literal("usd"), cents: Int }),
  /** Exact pesos at the run's recorded rate, half-up to the centavo, always with centavos ("₱7,990.00"). */
  z.strictObject({ k: z.literal("php"), centavos: Int }),
  /** Pesos as written on a slip ("₱200"; centavos only when the clerk wrote them). */
  z.strictObject({ k: z.literal("php_written"), centavos: Int }),
  /** A peso estimate for a PayPal line: whole pesos, floored, always labelled as an estimate. */
  z.strictObject({ k: z.literal("php_est"), centavos: NonNeg }),
  z.strictObject({ k: z.literal("kg"), grams: NonNeg }),
  z.strictObject({ k: z.literal("grade"), verifiedG: NonNeg, grade1G: NonNeg }),
  z.strictObject({ k: z.literal("text"), text: z.string() }),
  z.strictObject({ k: z.literal("slips"), serials: z.array(z.string().regex(/^\d{4}$/)) }),
  z.strictObject({ k: z.literal("slip"), serial: z.string().regex(/^\d{4}$/) }),
  z.strictObject({ k: z.literal("rule"), id: z.string().regex(/^R\d$/) }),
  z.strictObject({ k: z.literal("category"), category: z.enum(["CBU", "LOAN", "ADVANCE"]) }),
  z.strictObject({ k: z.literal("resolution"), resolutionNo: z.string() }),
  z.strictObject({ k: z.literal("pct"), bp: NonNeg }),
  z.strictObject({ k: z.literal("date"), iso: z.iso.date() }),
  /** The run's rate as centavos per cent (₱62.50 per US$ = 125/2). */
  z.strictObject({ k: z.literal("rate"), num: z.int().positive(), den: z.int().positive() }),
]);
export type Fact = z.infer<typeof Fact>;

export const Lang = z.enum(["ceb", "fil", "en"]);
export type Lang = z.infer<typeof Lang>;

export const PlannedSentence = z.strictObject({
  slot: StatementSlot,
  /** The template key is `{slot}.{variant}`. */
  variant: z.string().regex(/^[a-z_]+$/),
  facts: z.partialRecord(Placeholder, Fact),
  /** What the sentence names, for Paminawa's chips and MM-7: `slip:0403`, `rule:R1`. */
  mentions: z.array(z.string().regex(/^(slip|rule):[A-Za-z0-9-]+$/)),
});
export type PlannedSentence = z.infer<typeof PlannedSentence>;

export const SmsVariant = z.enum([
  "paid",
  "sent",
  "cash",
  "checking",
  "paid_short",
  "sent_short",
  "cash_short",
  "checking_short",
  "paid_usd",
  "sent_usd",
  "cash_usd",
]);
export type SmsVariant = z.infer<typeof SmsVariant>;

export const StatementPlan = z.strictObject({
  lineId: z.uuid(),
  lang: Lang,
  templateV: z.string(),
  sentences: z.array(PlannedSentence),
  sms: z.strictObject({ variant: SmsVariant, facts: z.partialRecord(Placeholder, Fact) }),
  /**
   * Where the line's slip readings came from (I8). Only `live`, a real Claude reading, lets the AI_NOTE say
   * Claude read the slips; anything else, null or absent takes the demo note (T1, `aiNoteVariant`).
   */
  readingProvenance: Provenance.nullable().optional(),
});
export type StatementPlan = z.infer<typeof StatementPlan>;

export type RenderMode = "display" | "spoken" | "sms";

export const RenderedSentence = z.strictObject({
  slot: StatementSlot,
  variant: z.string(),
  text: z.string(),
  mentions: z.array(z.string()),
});
export type RenderedSentence = z.infer<typeof RenderedSentence>;

/** A template set: `{slot}.{variant}` and `sms.{variant}` → words with {{PLACEHOLDERS}}, per language. */
export type TemplateSet = Readonly<Record<Lang, Readonly<Record<string, string>>>>;
