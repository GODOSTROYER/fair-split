// BR 2026-04 (ratified 14 Mar 2026, before slip 0301). The text layer is the human-verified page
// text that WS-MEDIA prints and AI-5's quotes are checked against; Schedule A wording is S4.3's,
// verbatim. The GA approval is cited inside the card (C-09: one hash, no ga_resolutions table).
import type { RateCardCanonical, RateTerm, RatifiedRateCard } from "@fairsplit/contracts";
import { jcsSha256, ratifyRateCard } from "@fairsplit/domain";
import { COOP, OFFICERS, PAYER, PRICING, RATE_CARD, SEASON } from "./constants.js";

export const SCHEDULE_A = {
  R0: "The premium paid by the buyer shall be shared among members in proportion to verified kilos delivered. No deduction of any kind shall be made from the premium. The quality bonus shall be shared in proportion to verified Grade 1 kilos.",
  R1: "Capital build-up (CBU): 5% of the member's quality bonus, until the member's paid-up CBU reaches ₱5,000.",
  R2: "Hauling: ₱1.50 per kilo of net weight for deliveries collected at a purok pickup point.",
  R3: "Loan repayment: only with a signed Authority to Deduct on file, and not more than 50% of the member's quality bonus.",
  R4: "Cash advance: only against a numbered voucher, and not more than 30% of the member's quality bonus.",
  R5: "The Chairperson shall co-sign any payout batch over US$300, any member line over US$150, and any override of a hold.",
  R6: "Verified kilos must agree with kilos shipped within ±2.0%. A member's season kilos may not exceed 1.6 kg per registered tree. Any reading below 0.85 confidence shall be confirmed by a person.",
  CLOSED:
    "No deduction other than those in this Schedule shall be applied to any member payout. This Schedule shall not be amended during Season 2026-A.",
} as const;

const chair = OFFICERS.find((o) => o.role === "CHAIR");
const secretary = OFFICERS.find((o) => o.role === "SECRETARY");

export const TEXT_LAYER = {
  pages: [
    {
      page: 1,
      lines: [
        COOP.fullName,
        COOP.locality,
        `BOARD RESOLUTION NO. ${RATE_CARD.resolutionNo}`,
        "Series of 2026",
        "RATIFYING THE SHARING RULES FOR THE SEASON 2026-A PREMIUM AND QUALITY BONUS",
        `WHEREAS, the General Assembly, in its meeting of 28 February 2026 (GA Resolution No. ${RATE_CARD.gaResolutionNo.replace("GA ", "")}), approved that any premium and quality bonus paid by ${PAYER.name} for Season 2026-A be shared among the members under rules ratified by the Board of Directors;`,
        `WHEREAS, ${PAYER.name} agreed to pay a premium of US$0.30 per kilo shipped and a quality bonus of US$0.15 per Grade 1 kilo shipped, plus disbursement costs of US$60.00, for Season 2026-A, 1 April to 31 August 2026;`,
        "NOW, THEREFORE, the Board resolves to adopt the following Schedule A.",
        "SCHEDULE A",
        `R0 ${SCHEDULE_A.R0}`,
        `R1 ${SCHEDULE_A.R1}`,
        `R2 ${SCHEDULE_A.R2}`,
      ],
    },
    {
      page: 2,
      lines: [
        `R3 ${SCHEDULE_A.R3}`,
        `R4 ${SCHEDULE_A.R4}`,
        `R5 ${SCHEDULE_A.R5}`,
        `R6 ${SCHEDULE_A.R6}`,
        SCHEDULE_A.CLOSED,
        "Approved and ratified on 14 March 2026.",
        `Certified by: ${secretary?.name.toUpperCase()}, Secretary`,
        `Attested by: ${chair?.name.toUpperCase()}, Chairperson`,
      ],
    },
  ],
};

function term(
  t: Omit<RateTerm, "source" | "capAsWritten" | "conditionAsWritten" | "requiresDocument"> &
    Partial<Pick<RateTerm, "capAsWritten" | "conditionAsWritten" | "requiresDocument">> & {
      page: number;
      quote: string;
    },
): RateTerm {
  return {
    ruleId: t.ruleId,
    pool: t.pool,
    kind: t.kind,
    basis: t.basis,
    label: t.label,
    valueAsWritten: t.valueAsWritten,
    capAsWritten: t.capAsWritten ?? "",
    conditionAsWritten: t.conditionAsWritten ?? "",
    requiresDocument: t.requiresDocument ?? "NONE",
    source: { page: t.page, quote: t.quote },
  };
}

export const TERMS: RateTerm[] = [
  term({
    ruleId: "R0",
    pool: "PREMIUM",
    kind: "SHARE",
    basis: "VERIFIED_KG",
    label: "Premium by verified kilos, never deducted",
    valueAsWritten: "in proportion to verified kilos delivered",
    page: 1,
    quote: SCHEDULE_A.R0,
  }),
  term({
    ruleId: "R0",
    pool: "BONUS",
    kind: "SHARE",
    basis: "VERIFIED_G1_KG",
    label: "Quality bonus by verified Grade 1 kilos",
    valueAsWritten: "in proportion to verified Grade 1 kilos",
    page: 1,
    quote: SCHEDULE_A.R0,
  }),
  term({
    ruleId: "R1",
    pool: "BONUS",
    kind: "DEDUCTION",
    basis: "PCT_OF_BONUS",
    label: "Capital build-up (CBU)",
    valueAsWritten: "5%",
    capAsWritten: "₱5,000",
    conditionAsWritten: "until the member's paid-up CBU reaches ₱5,000",
    page: 1,
    quote: SCHEDULE_A.R1,
  }),
  term({
    ruleId: "R2",
    pool: "NONE",
    kind: "DEDUCTION",
    basis: "PER_NET_KG",
    label: "Hauling",
    valueAsWritten: "₱1.50",
    conditionAsWritten: "deliveries collected at a purok pickup point",
    page: 1,
    quote: SCHEDULE_A.R2,
  }),
  term({
    ruleId: "R3",
    pool: "BONUS",
    kind: "DEDUCTION",
    basis: "PCT_OF_BONUS",
    label: "Loan repayment",
    valueAsWritten: "outstanding loan",
    capAsWritten: "50%",
    conditionAsWritten: "only with a signed Authority to Deduct on file",
    requiresDocument: "AUTHORITY_TO_DEDUCT",
    page: 2,
    quote: SCHEDULE_A.R3,
  }),
  term({
    ruleId: "R4",
    pool: "BONUS",
    kind: "DEDUCTION",
    basis: "PCT_OF_BONUS",
    label: "Cash advance",
    valueAsWritten: "advance against voucher",
    capAsWritten: "30%",
    conditionAsWritten: "only against a numbered voucher",
    requiresDocument: "VOUCHER",
    page: 2,
    quote: SCHEDULE_A.R4,
  }),
  term({
    ruleId: "R5",
    pool: "NONE",
    kind: "COSIGN",
    basis: "BATCH_TOTAL",
    label: "Chairperson co-signs",
    valueAsWritten: "US$300",
    capAsWritten: "US$150",
    conditionAsWritten:
      "any payout batch over US$300, any member line over US$150, and any override of a hold",
    page: 2,
    quote: SCHEDULE_A.R5,
  }),
  term({
    ruleId: "R6",
    pool: "NONE",
    kind: "TOLERANCE",
    basis: "MASS_BALANCE",
    label: "Tolerances",
    valueAsWritten: "±2.0%",
    capAsWritten: "1.6 kg per registered tree",
    conditionAsWritten: "Any reading below 0.85 confidence shall be confirmed by a person",
    page: 2,
    quote: SCHEDULE_A.R6,
  }),
  term({
    ruleId: "CLOSED",
    pool: "NONE",
    kind: "CLOSED_LIST",
    basis: "NONE",
    label: "Closed list",
    valueAsWritten: "No deduction other than those in this Schedule",
    page: 2,
    quote: SCHEDULE_A.CLOSED,
  }),
];

export function textLayerString(): string {
  return TEXT_LAYER.pages.flatMap((p) => p.lines).join("\n");
}

export function buildRateCard(): RatifiedRateCard {
  const canonical: RateCardCanonical = {
    v: 1,
    season: SEASON.code,
    resolutionNo: RATE_CARD.resolutionNo,
    ratifiedOn: RATE_CARD.ratifiedOn,
    gaCitation: { resolutionNo: RATE_CARD.gaResolutionNo, approvedOn: RATE_CARD.gaApprovedOn },
    pricing: { ...PRICING },
    rules: {
      share: {
        ruleId: "R0",
        premiumBasis: "VERIFIED_KG",
        bonusBasis: "VERIFIED_G1_KG",
        premiumNeverDeducted: true,
      },
      cbu: { ruleId: "R1", bp: 500, paidUpCapCentavos: 500_000 },
      hauling: { ruleId: "R2", centavosPerNetKg: 150, stations: ["PUROK_2", "PUROK_4"] },
      loan: { ruleId: "R3", capBp: 5_000, requires: "AUTHORITY_TO_DEDUCT" },
      advance: { ruleId: "R4", capBp: 3_000, requires: "VOUCHER" },
      cosign: { ruleId: "R5", batchOverCents: 30_000, lineOverCents: 15_000, anyOverride: true },
      tolerances: { ruleId: "R6", massBalanceTolBp: 200, kgPerTreeMaxG: 1_600, autoAcceptBp: 8_500 },
      closedList: { ruleId: "CLOSED", deductionRuleIds: ["R1", "R2", "R3", "R4"], amendableInSeason: false },
    },
    terms: [...TERMS].sort((a, b) => (a.ruleId + a.pool < b.ruleId + b.pool ? -1 : 1)),
    documents: [{ name: "BR 2026-04 text layer", sha256: jcsSha256(TEXT_LAYER) }],
  };
  return ratifyRateCard(canonical, RATE_CARD.ratifiedAt, [
    { role: "SECRETARY", name: secretary?.name ?? "", act: "CERTIFIED", at: RATE_CARD.ratifiedAt },
    { role: "CHAIR", name: chair?.name ?? "", act: "ATTESTED", at: "2026-03-14T08:05:00.000Z" },
  ]);
}
