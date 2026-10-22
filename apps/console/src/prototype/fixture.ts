// The G1 prototype's data: figures copied from the decision register §2 until packages/seed lands
// (IC-03 freezes on 24 Oct). Everything is integer US cents and tenths of a kilo. Per-column splits that the
// register does not print are derived here with its own rules (premium by verified kg, bonus by Grade 1 kg,
// CBU 5% of the bonus rounded half-up, loans capped at 50% of the bonus rounded down); two lines take the
// one-cent largest-remainder adjustment so every row sums to the register's net. A test checks every figure
// against the register. This file is replaced by the seed snapshot; nothing here is product logic.

import { canonicalJson, sha256Hex } from "./hash.js";

export const COOP = {
  name: "Bulawanon Kakaw Growers MPC",
  place: "Calinan, Davao City",
  members: 64,
  women: 26,
} as const;

export const PEOPLE = {
  treasurer: { name: "Analyn R. Sumalinog", short: "Analyn", initials: "AS", role: "Treasurer" },
  chair: { name: "Ernesto P. Cabahug", short: "Ernesto", initials: "EC", role: "Chairperson" },
  secretary: { name: "Ma. Theresa L. Gumapac", initials: "TG", role: "Secretary" },
  clerk: { name: "Jessie D. Dumaguing", initials: "JD", role: "Clerk" },
  payer: { company: "Lantern Bay Chocolate Co.", city: "Oakland", contact: "Dana Whitfield-Santos" },
} as const;

export const SEASON = {
  code: "2026-A",
  id: "2026A",
  runSeq: 37,
  runSlug: "2026A-r37",
  invoiceNumber: "FS-2026A-r37",
  lot: "LB-PH-2026-03",
  sacks: 154,
  rateCard: "BR 2026-04",
  ratified: "14 Mar",
  ratifiedLong: "14 Mar 2026",
  cashDay: "30 Oct",
  cashDayCeb: "30 Okt",
  autoCancel: "30 Nov",
  replayDate: "29 Oct",
  photos: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
} as const;

/** ₱62.50 per US$, display only, fixed for the run. */
export const FX = 62.5;

export const RULES = {
  coSignBatchCents: 30_000,
  massBalanceLimitBp: 200,
  yieldLimit: "1.6",
  autoAccept: 0.85,
} as const;

/** Register §2: the invoice and the pool. */
export const INVOICE = {
  premiumCents: 288_750,
  bonusCents: 138_600,
  disbursementCents: 6_000,
  totalCents: 433_350,
} as const;

export const TOTALS = {
  verifiedKgTenths: 97_806,
  gradeOneKgTenths: 93_880,
  grossCents: 427_350,
  ruledDeductionsCents: 5_853,
  creditsCents: 320,
  netCents: 421_817,
  paypalCents: 36_839,
  paypalCount: 8,
  cashCents: 384_978,
  cashCount: 56,
  redirectedCents: 2_114,
  duplicateMovedCents: 1_794,
  shrinkBp: 162,
  shrinkWithDuplicateBp: 205,
  finalPaypalCents: 34_174,
  finalPaypalCount: 7,
  finalCashCents: 387_643,
  finalCashCount: 57,
  feeSandboxEachCents: 25,
  feeSandboxCents: 200,
  feeProductionCents: 737,
} as const;

export type Rail = "paypal" | "cash";
export type Lang = "ceb" | "fil" | "en";

export interface MemberSource {
  readonly no: string;
  readonly name: string;
  /** How the statement greets them (from the registry, never guessed). */
  readonly greeting: string;
  readonly lang: Lang;
  readonly rail: Rail;
  readonly kgTenths: number;
  readonly gradeOneTenths: number;
  /** Register §2 net, after every hold resolved. */
  readonly netCents: number;
  readonly cbu: boolean;
  readonly loanCapped?: boolean;
  readonly creditCents?: number;
  /** One-cent largest-remainder adjustments the register's nets imply. */
  readonly premiumAdjust?: number;
  readonly hold?: "H1" | "H2" | "H3" | "BY_HAND";
  readonly note: string;
}

export const MEMBERS: readonly MemberSource[] = [
  {
    no: "M-002",
    name: "Florencia Ybañez",
    greeting: "Nang Ciay",
    lang: "ceb",
    rail: "paypal",
    kgTenths: 740,
    gradeOneTenths: 600,
    netCents: 3027,
    cbu: true,
    note: "Signs with a thumbmark; audio first",
  },
  {
    no: "M-007",
    name: "Dionisio Lapinig",
    greeting: "Nong Dioning",
    lang: "ceb",
    rail: "paypal",
    kgTenths: 1440,
    gradeOneTenths: 1440,
    netCents: 6271,
    cbu: true,
    hold: "H1",
    note: "H1: slip 0457 counted twice",
  },
  {
    no: "M-014",
    name: "Consolacion Bacus",
    greeting: "Nang Celing",
    lang: "ceb",
    rail: "paypal",
    kgTenths: 1480,
    gradeOneTenths: 1480,
    netCents: 6445,
    cbu: true,
    note: "Hero line",
  },
  {
    no: "M-018",
    name: "Teodoro Pacaña",
    greeting: "Nong Tidoy",
    lang: "ceb",
    rail: "paypal",
    kgTenths: 1204,
    gradeOneTenths: 1204,
    netCents: 5563,
    cbu: true,
    creditCents: 320,
    premiumAdjust: -1,
    hold: "H3",
    note: "H3: ₱200 multa returned as +3.20",
  },
  {
    no: "M-022",
    name: "Pedro Ompad",
    greeting: "Nong Pedring",
    lang: "ceb",
    rail: "paypal",
    kgTenths: 965,
    gradeOneTenths: 800,
    netCents: 3440,
    cbu: false,
    loanCapped: true,
    note: "Loan −5.90 at the 50% cap",
  },
  {
    no: "M-031",
    name: "Rhea Jumawan",
    greeting: "Rhea",
    lang: "en",
    rail: "paypal",
    kgTenths: 612,
    gradeOneTenths: 612,
    netCents: 2665,
    cbu: true,
    premiumAdjust: -1,
    note: "Address with no PayPal account: unclaimed",
  },
  {
    no: "M-039",
    name: "Jonathan Ripalda",
    greeting: "Jonathan",
    lang: "en",
    rail: "paypal",
    kgTenths: 880,
    gradeOneTenths: 880,
    netCents: 3832,
    cbu: true,
    note: "",
  },
  {
    no: "M-053",
    name: "Merlyn Ponce",
    greeting: "Merlyn",
    lang: "ceb",
    rail: "cash",
    kgTenths: 3000,
    gradeOneTenths: 2800,
    netCents: 12_784,
    cbu: true,
    hold: "H2",
    note: "H2: 140 trees, so she registers plot P-053-B",
  },
  {
    no: "M-060",
    name: "Arnel Sumampao",
    greeting: "Arnel",
    lang: "fil",
    rail: "paypal",
    kgTenths: 1285,
    gradeOneTenths: 1285,
    netCents: 5596,
    cbu: true,
    hold: "BY_HAND",
    note: "Field 0462 entered by hand",
  },
];

export interface Line {
  readonly member: MemberSource;
  readonly kgTenths: number;
  readonly premiumCents: number;
  readonly bonusCents: number;
  readonly cbuCents: number;
  readonly loanCents: number;
  readonly creditCents: number;
  readonly netCents: number;
}

const halfUp = (x: number) => Math.floor(x + 0.5 + 1e-9);

function split(m: MemberSource, kgTenths: number, gradeOneTenths: number, totalKg: number, totalG1: number) {
  const premium = halfUp((INVOICE.premiumCents * kgTenths) / totalKg);
  const bonus = halfUp((INVOICE.bonusCents * gradeOneTenths) / totalG1);
  const cbu = m.cbu ? halfUp(bonus * 0.05) : 0;
  const loan = m.loanCapped ? Math.floor(bonus * 0.5) : 0;
  return { premium, bonus, cbu, loan };
}

/** A line after every hold is resolved: the register's figures. */
export function lineAfter(m: MemberSource): Line {
  const s = split(m, m.kgTenths, m.gradeOneTenths, TOTALS.verifiedKgTenths, TOTALS.gradeOneKgTenths);
  const premium = s.premium + (m.premiumAdjust ?? 0);
  const credit = m.creditCents ?? 0;
  return {
    member: m,
    kgTenths: m.kgTenths,
    premiumCents: premium,
    bonusCents: s.bonus,
    cbuCents: s.cbu,
    loanCents: s.loan,
    creditCents: credit,
    netCents: premium + s.bonus - s.cbu - s.loan + credit,
  };
}

/**
 * A line while H1 is open: slip 0457's 42.0 kg is still counted twice (Nong Dioning's line holds it), and
 * H3's credit has not been granted. Pro-rata over the inflated totals, so 63 rows sit a few cents low.
 */
export function lineWithDuplicate(m: MemberSource): Line {
  const dup = m.no === "M-007" ? 420 : 0;
  const s = split(
    m,
    m.kgTenths + dup,
    m.gradeOneTenths + dup,
    TOTALS.verifiedKgTenths + 420,
    TOTALS.gradeOneKgTenths + 420,
  );
  return {
    member: m,
    kgTenths: m.kgTenths + dup,
    premiumCents: s.premium,
    bonusCents: s.bonus,
    cbuCents: s.cbu,
    loanCents: s.loan,
    creditCents: 0,
    netCents: s.premium + s.bonus - s.cbu - s.loan,
  };
}

/** The hero line, M-014 Nang Celing. */
export const HERO = MEMBERS.find((m) => m.no === "M-014") as MemberSource;
export const HERO_SLIPS = ["0403", "0419", "0436", "0467"] as const;
export const HERO_SLIP_0403_KG = "38.45 kg";

/** Rate per kilo the premium works out to for the hero (S1: "US$0.2952 a kg"). */
export const HERO_RATE = "US$0.2952";

export const HOLDS = {
  H1: {
    slip: "0457",
    member: "M-007",
    kgTenths: 420,
    photoA: "B",
    photoB: "D",
  },
  H2: { member: "M-053", trees: 140, kgPerTree: "2.14", plot: "P-053-B", plotHa: "0.60", plotTrees: 330 },
  H3: { slip: "0458", member: "M-018", multa: "₱200", hauling: "₱91.20" },
  byHand: { slip: "0462", member: "M-060", read: "6?.80", score: 0.4, logbook: "64.50" },
} as const;

/** The rate card the Board ratified, as canonical text: the stand-in for BR 2026-04's hashed form. */
export const RATE_CARD_TEXT = canonicalJson({
  card: "BR 2026-04",
  ratified: "2026-03-14",
  season: "2026-A",
  rules: [
    { id: "R0", text: "Premium is paid by verified kilos and is never deducted." },
    { id: "R1", text: "CBU: 5% of the bonus until 5000 PHP is paid up." },
    { id: "R2", text: "Hauling: 1.50 PHP a kg for purok pickups." },
    { id: "R3", text: "Loan: only with a signed Authority to Deduct, up to 50% of the bonus." },
    { id: "R4", text: "Advance: only with a voucher, up to 30% of the bonus." },
  ],
  coSign: { batchOverCents: 30000, lineOverCents: 15000, overrides: true },
  massBalanceToleranceBp: 200,
  yieldLimitKgPerTree: "1.6",
  autoAccept: "0.85",
});

export const RATE_CARD_SHA256 = sha256Hex(RATE_CARD_TEXT);
export const RC8 = RATE_CARD_SHA256.slice(0, 8);
export const SENDER_BATCH_ID = `${SEASON.id}-${RC8}-r${SEASON.runSeq}`;

/** The eight PayPal items, sorted by sender_item_id, as the batch digest sees them. */
export const BATCH_ITEMS = MEMBERS.filter((m) => m.rail === "paypal")
  .map((m) => ({
    senderItemId: `r${SEASON.runSeq}-${m.no}`,
    receiver: `${m.no.toLowerCase()}@sandbox.fairsplit.invalid`,
    amountCents: m.netCents,
    currency: "USD",
  }))
  .sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : 1));

/** The stand-in batch digest the seal grows from (register §8's formula, fixture inputs). */
export const BATCH_SHA256 = sha256Hex(
  canonicalJson({
    runId: SEASON.runSlug,
    senderBatchId: SENDER_BATCH_ID,
    rateCardSha256: RATE_CARD_SHA256,
    items: BATCH_ITEMS,
  }),
);

/** Run-log rows on the stage before the first press. */
export const STAGE_LOG = [
  {
    lane: "machine",
    words: "Claude drafted invoice FS-2026A-r37 with the PayPal Agent Toolkit",
    detail: "create_invoice, policy allow (invoiceEqualsQuote), 10:18:02",
  },
  {
    lane: "people",
    words: "Analyn sent the invoice to Lantern Bay",
    detail: "send_invoice, seeded treasurer approval (labelled), 10:18:04",
  },
  {
    lane: "paypal",
    words: "Auto-cancel set for 30 Nov",
    detail: "create_conditional_rules_for_invoice, AUTO_CANCEL on a specific date, 10:18:05",
  },
] as const;
