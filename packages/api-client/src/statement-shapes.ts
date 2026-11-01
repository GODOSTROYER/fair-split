// Mirrors the server statement projection while it remains outside IC-01.
// API JSON Schema parity tests prevent client/server drift without changing frozen contracts.
import { MemberLineState, MoneyDTO, PayoutItemStatus, Provenance } from "@fairsplit/contracts";
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

const Hero = z.object({
  kind: z.enum(["paypal", "cash"]),
  cents: z.int(),
  amount: z.string(),
  spoken: z.string(),
  estimate: z.string().nullable(),
  usd: z.string(),
  rate: z.string(),
});
const ReceiptRow = z.object({
  id: z.string(),
  kind: z.enum(["premium", "bonus", "deduction", "credit", "net"]),
  cents: z.int(),
  amount: z.string(),
  spoken: z.string(),
  ruleId: z.string().optional(),
  label: z.string().optional(),
  slip: z.string().optional(),
  writtenCentavos: z.int().optional(),
});
export const MobileStatement = z.object({
  lineId: z.uuid(),
  runId: z.uuid(),
  runSlug: z.string(),
  provenance: Provenance,
  coop: z.object({ name: z.string(), place: z.string() }),
  season: z.object({ id: z.uuid(), code: z.string() }),
  payer: z.object({ short: z.string() }),
  member: z.object({
    memberNo: z.string(),
    displayName: z.string(),
    nameByLang: z.object({ ceb: z.string(), fil: z.string(), en: z.string() }),
    lang: z.enum(["ceb", "fil", "en"]),
  }),
  treasurer: z.object({ first: z.string(), name: z.string(), initials: z.string() }),
  rail: z.enum(["PAYPAL", "CASH"]),
  lineState: MemberLineState,
  item: z
    .object({
      senderItemId: z.string(),
      status: PayoutItemStatus.exclude(["SUBMITTED"]),
      updatedAt: z.string(),
      verified: z.boolean(),
      provenance: Provenance,
    })
    .nullable(),
  kilos: z.object({ netGrams: z.int(), grade1Grams: z.int(), coopVerifiedGrams: z.int() }),
  amounts: z
    .object({
      premiumCents: z.int(),
      bonusCents: z.int(),
      netCents: z.int(),
      deductions: z.array(z.object({ ruleId: z.string(), label: z.string(), cents: z.int() })),
      credits: z.array(z.object({ slip: z.string(), writtenCentavos: z.int(), cents: z.int() })),
    })
    .nullable(),
  fx: z.object({ phpPerUsd: z.string() }),
  slips: z.array(
    z.object({
      serial: z.string(),
      netGrams: z.int(),
      deliveredOn: z.string(),
      cropUrl: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      kind: z.enum(["approved", "sent", "paid", "unclaimed", "cash-due", "received", "held"]),
      at: z.string(),
      by: z.array(z.string()).optional(),
    }),
  ),
  rateCard: z.object({ id: z.uuid(), sha256: z.string(), ratifiedAt: z.string() }),
  batchSha256: z.string().nullable(),
  cashDay: z.string().nullable(),
  expectedDate: z.string().nullable(),
  spokenHashes: z.array(z.string()),
  formatted: z.object({
    hero: z.object({ paypal: Hero, cash: Hero }).nullable(),
    receiptRows: z.array(ReceiptRow),
    share: z.object({ kg: z.string(), coopKg: z.string(), grade1Kg: z.string(), allGrade1: z.boolean() }),
    conservation: z.object({ ok: z.boolean(), computedCents: z.int(), netCents: z.int() }).nullable(),
  }),
});
export type MobileStatement = z.infer<typeof MobileStatement>;

export const StatementView = z.strictObject({
  lineId: z.uuid(),
  memberNo: z.string(),
  lang: Lang,
  registryLang: Lang,
  langs: z.array(Lang),
  state: MemberLineState,
  /** What the pay sentence says: still being checked, moved on, cash at the bodega or PayPal. */
  pay: z.enum(["checking", "excluded", "cash", "paypal"]),
  /** The register's status words for this state, in this language (a raw state name is never shown). */
  statusWords: z.string(),
  /** "Machine-translated, pending native review" for ceb and fil until signed off (OD-2). */
  reviewChip: z.string().nullable(),
  amount: z
    .strictObject({
      usd: MoneyDTO,
      php: z.strictObject({ centavos: z.int(), display: z.string(), exact: z.boolean() }).nullable(),
      spoken: z.string(),
    })
    .nullable(),
  plan: StatementPlan,
  display: z.array(RenderedSentence),
  spoken: z.array(RenderedSentence),
  sms: z.strictObject({
    text: z.string(),
    gsm7Length: z.int().nonnegative().nullable(),
    fits: z.boolean(),
    /** Previews are never sent from here. */
    label: z.literal("Preview, not sent"),
  }),
  source: z.enum(["template", "model"]),
  provenance: Provenance,
  /** Additive app projection; amounts are formatted only on fs-api. */
  mobile: MobileStatement,
});
export type StatementView = z.infer<typeof StatementView>;
