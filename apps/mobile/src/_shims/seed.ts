/**
 * TEMPORARY SHIM: replace with the @fairsplit/seed snapshot (`packages/seed/snapshot/season-2026A.json`, IC-03)
 * after WS-CORE merges.
 *
 * A local fixture for the hero line (register §2, M-014) and the co-sign batch, so the app renders realistic data
 * before the seed lands. Figures copy register §2 to the cent; hashes are computed here, never typed. Slips 0419,
 * 0436 and 0467 are `provisional`: the register fixes only slip 0403 (38.45 kg) and the 148.0 kg total, so their
 * kilos and dates mirror WS-CORE's draft snapshot (not on main yet) and are labelled as samples in the UI.
 */
import type { BatchItem, DigestLine, HoldKind, Lang, StatementTemplate } from "./contracts";
import { batchDigest, linesDigest as digestLines, jcs, sha256Hex } from "./domain";

export const coop = {
  name: "Bulawanon Kakaw Growers MPC",
  place: "Calinan, Davao City",
  /** Verified kilos after slip 0457 is counted once (register §2): the denominator of every member's share. */
  verifiedGrams: 9_780_600,
} as const;
export const season = { code: "2026-A", id: "2026A", lot: "LB-PH-2026-03" } as const;
export const payer = { name: "Lantern Bay Chocolate Co.", short: "Lantern Bay" } as const;
export const fx = { phpPerUsd: "62.50" } as const;
export const runSeq = 37;
export const runSlug = `${season.id}-r${runSeq}`;
export const runId = "run_2026A_r37_fixture";

export const people = {
  /** `fs-analyn-w1`: the treasurer's non-extractable WebCrypto key, registered from /ops (approved plan). */
  treasurer: {
    name: "Analyn R. Sumalinog",
    first: "Analyn",
    initials: "AS",
    keyId: "fs-analyn-w1",
    approverId: "treasurer:analyn",
  },
  chair: {
    name: "Ernesto P. Cabahug",
    first: "Ernesto",
    initials: "EC",
    keyId: "fs-ernesto-a1",
    approverId: "board:ernesto",
  },
  clerk: { name: "Jessie D. Dumaguing", first: "Jessie", initials: "JD" },
} as const;

/** BR 2026-04, Schedule A (design §0). Hashed for the fixture; the seed's canonical card replaces it. */
export const rateCard = {
  id: "BR 2026-04",
  seasonId: season.id,
  ratifiedAt: "2026-03-14",
  premiumUsdPerShippedKg: "0.30",
  bonusUsdPerShippedGrade1Kg: "0.15",
  rules: [
    { id: "R0", text: "Premium is paid by verified kilos and is never deducted." },
    { id: "R1", text: "CBU is 5% of the bonus until the member has P5,000 paid up." },
    { id: "R2", text: "Hauling is P1.50 per kg for purok pickups." },
    { id: "R3", text: "A loan is deducted only with a signed Authority to Deduct, up to 50% of the bonus." },
    { id: "R4", text: "An advance is deducted only with a voucher, up to 30% of the bonus." },
  ],
  cosign: { batchOverCents: 30000, lineOverCents: 15000, overrides: true },
  massBalanceTolerancePct: "2.0",
} as const;

export const rateCardSha256 = sha256Hex(jcs(rateCard));
export const senderBatchId = `${season.id}-${rateCardSha256.slice(0, 8)}-r${runSeq}`;

/** The eight PayPal lines (register §2), net cents. Receivers are fixture aliases, not sandbox accounts. */
const paypalLines: readonly [memberNo: string, cents: number][] = [
  ["M-014", 6445],
  ["M-007", 6271],
  ["M-060", 5596],
  ["M-018", 5563],
  ["M-039", 3832],
  ["M-022", 3440],
  ["M-002", 3027],
  ["M-031", 2665],
];

export const batchItems: readonly BatchItem[] = paypalLines.map(([memberNo, amountCents]) => ({
  senderItemId: `r${runSeq}-${memberNo}`,
  receiver: `${memberNo.toLowerCase().replace("-", "")}@sandbox.fairsplit.invalid`,
  amountCents,
  currency: "USD",
}));

export const batchSha256 = batchDigest({ runId, senderBatchId, rateCardSha256 }, batchItems);
export const batchTotalCents = batchItems.reduce((s, i) => s + i.amountCents, 0);

/**
 * The named lines of register §2 (eight on PayPal, Merlyn in cash). The seed's 64 lines replace this list, so the
 * fixture's `linesDigest` covers only these nine.
 */
export const namedLines: readonly DigestLine[] = [
  ...paypalLines.map(([memberNo, netCents]) => ({ memberNo, rail: "PAYPAL" as const, netCents })),
  { memberNo: "M-053", rail: "CASH", netCents: 12784 },
];
export const linesDigest = digestLines(runId, namedLines);

export interface SlipFixture {
  serial: string;
  netGrams: number;
  deliveredOn: string;
  photo: string;
  provisional: boolean;
}

/** M-014's slips: 0403 is 38.45 kg (register §2); the others mirror the seed draft and sum to 148.0 kg. */
export const heroSlips: readonly SlipFixture[] = [
  { serial: "0403", netGrams: 38450, deliveredOn: "2026-06-02", photo: "P26", provisional: false },
  { serial: "0419", netGrams: 36800, deliveredOn: "2026-06-10", photo: "P30", provisional: true },
  { serial: "0436", netGrams: 35250, deliveredOn: "2026-06-20", photo: "E", provisional: true },
  { serial: "0467", netGrams: 37500, deliveredOn: "2026-07-07", photo: "K", provisional: true },
];

export const heroLine = {
  memberNo: "M-014",
  displayName: "Consolacion Bacus",
  nameByLang: { ceb: "Nang Celing", fil: "Gng. Bacus", en: "Mrs. Bacus" } satisfies Record<Lang, string>,
  lang: "ceb" as Lang,
  rail: "PAYPAL" as const,
  netGrams: 148000,
  grade1Grams: 148000,
  premiumCents: 4369,
  bonusCents: 2185,
  deductions: [{ ruleId: "R1", label: "CBU", cents: 109 }] as const,
  creditsCents: 0,
  netCents: 6445,
  senderItemId: `r${runSeq}-M-014`,
} as const;

/**
 * Statement templates (S1.11 as amended by the approved plan): one sentence per slot, words and placeholders only,
 * no digits. PAY has a PayPal and a cash variant; the cash one is used if the line moves to the bodega. The PayPal
 * peso is the run-rate estimate; PayPal's conversion fee and GCash's are shown as their own receipt segment.
 */
export const statementTemplates: Readonly<Record<Lang, readonly StatementTemplate[]>> = {
  ceb: [
    {
      id: "greeting",
      slot: "GREETING",
      text: "Maayong adlaw, {{HONORIFIC_NAME}}. Salamat sa inyong paghago.",
    },
    {
      id: "delivery",
      slot: "DELIVERY",
      text: "Nagdala mo og {{KG_TOTAL}} nga uga nga cacao, {{GRADE_SUMMARY}}.",
    },
    { id: "premium", slot: "PREMIUM", text: "Premium gikan sa {{PAYER}}: {{PREMIUM_USD}}, walay kaltas." },
    { id: "bonus", slot: "BONUS", text: "Bonus sa kalidad: {{BONUS_USD}}." },
    {
      id: "deduction-R1",
      slot: "DEDUCTION",
      ref: "R1",
      text: "Gikaltasan og {{DEDUCTION_USD}} para sa {{RULE_LABEL}} ({{RULE}}, {{BR}}).",
    },
    {
      id: "pay",
      slot: "PAY",
      variant: "paypal",
      text: "Ang inyong bayad karong season: {{NET_USD}}, sa inyong PayPal. Kung ilisan sa peso, mga {{NET_PHP}}.",
    },
    {
      id: "pay-cash",
      slot: "PAY",
      variant: "cash",
      text: "Ang inyong bayad karong season: {{NET_PHP}}, cash sa bodega sa {{CASH_DATE}}.",
    },
    { id: "sources", slot: "SOURCES", text: "Gikan kini sa inyong resibo {{SLIPS}}." },
    { id: "help", slot: "HELP", text: "Naa moy pangutana? Adto kang Treasurer {{TREASURER}} sa bodega." },
    {
      id: "ai-note",
      slot: "AI_NOTE",
      text: "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude). Ang mga pagbasa nga dili sigurado gisusi sa usa ka tawo, ug si Treasurer {{TREASURER}} ang miaprobar niini nga bayad.",
    },
  ],
  fil: [
    {
      id: "greeting",
      slot: "GREETING",
      text: "Magandang araw po, {{HONORIFIC_NAME}}. Salamat po sa inyong pagsisikap.",
    },
    {
      id: "delivery",
      slot: "DELIVERY",
      text: "Nagdala po kayo ng {{KG_TOTAL}} na tuyong cacao, {{GRADE_SUMMARY}}.",
    },
    { id: "premium", slot: "PREMIUM", text: "Premium mula sa {{PAYER}}: {{PREMIUM_USD}}, walang kaltas." },
    { id: "bonus", slot: "BONUS", text: "Bonus sa kalidad: {{BONUS_USD}}." },
    {
      id: "deduction-R1",
      slot: "DEDUCTION",
      ref: "R1",
      text: "Binawasan po ng {{DEDUCTION_USD}} para sa {{RULE_LABEL}} ({{RULE}}, {{BR}}).",
    },
    {
      id: "pay",
      slot: "PAY",
      variant: "paypal",
      text: "Ang inyong bayad ngayong season: {{NET_USD}}, sa inyong PayPal. Kapag pinalitan sa piso, humigit-kumulang {{NET_PHP}}.",
    },
    {
      id: "pay-cash",
      slot: "PAY",
      variant: "cash",
      text: "Ang inyong bayad ngayong season: {{NET_PHP}}, cash sa bodega sa {{CASH_DATE}}.",
    },
    { id: "sources", slot: "SOURCES", text: "Galing po ito sa inyong mga resibo {{SLIPS}}." },
    {
      id: "help",
      slot: "HELP",
      text: "May tanong po kayo? Lumapit po kay Treasurer {{TREASURER}} sa bodega.",
    },
    {
      id: "ai-note",
      slot: "AI_NOTE",
      text: "Dalawang beses binasa ng AI (Claude) ang inyong mga resibo. Ang mga pagbasang hindi tiyak ay sinuri ng isang tao, at inaprubahan ni Treasurer {{TREASURER}} ang bayad na ito.",
    },
  ],
  en: [
    { id: "greeting", slot: "GREETING", text: "Good day, {{HONORIFIC_NAME}}. Thank you for your hard work." },
    {
      id: "delivery",
      slot: "DELIVERY",
      text: "You delivered {{KG_TOTAL}} of dried cacao, {{GRADE_SUMMARY}}.",
    },
    { id: "premium", slot: "PREMIUM", text: "Premium from {{PAYER}}: {{PREMIUM_USD}}, with no deductions." },
    { id: "bonus", slot: "BONUS", text: "Quality bonus: {{BONUS_USD}}." },
    {
      id: "deduction-R1",
      slot: "DEDUCTION",
      ref: "R1",
      text: "Less {{DEDUCTION_USD}} for {{RULE_LABEL}} ({{RULE}}, {{BR}}).",
    },
    {
      id: "pay",
      slot: "PAY",
      variant: "paypal",
      text: "Your pay this season: {{NET_USD}}, to your PayPal. Changed to pesos, about {{NET_PHP}}.",
    },
    {
      id: "pay-cash",
      slot: "PAY",
      variant: "cash",
      text: "Your pay this season: {{NET_PHP}}, in cash at the bodega on {{CASH_DATE}}.",
    },
    { id: "sources", slot: "SOURCES", text: "It comes from your slips {{SLIPS}}." },
    { id: "help", slot: "HELP", text: "Questions? See Treasurer {{TREASURER}} at the bodega." },
    {
      id: "ai-note",
      slot: "AI_NOTE",
      text: "Your slips were read twice by AI (Claude). Readings it was unsure of were checked by a person, and Treasurer {{TREASURER}} approved this pay.",
    },
  ],
};

export interface HoldSummaryFixture {
  id: string;
  kind: HoldKind;
  summary: string;
  resolvedBy: string;
  resolvedAt: string;
}

/** The three holds, resolved flush in ink with Analyn's stamp (engine template text; digits come from code). */
export const resolvedHolds: readonly HoldSummaryFixture[] = [
  {
    id: "H1",
    kind: "DUPLICATE_SLIP",
    summary: "Slip 0457 counted once. US$17.94 returned to 63 members.",
    resolvedBy: "AS",
    resolvedAt: "2026-10-29T10:14:00+08:00",
  },
  {
    id: "H2",
    kind: "IMPLAUSIBLE_YIELD",
    summary: "Plot P-053-B registered. 300.0 kg from 470 trees, inside the limit.",
    resolvedBy: "AS",
    resolvedAt: "2026-10-29T10:16:00+08:00",
  },
  {
    id: "H3",
    kind: "NO_RULE",
    summary: "The ₱200 multa on slip 0458 returned as a US$3.20 credit.",
    resolvedBy: "AS",
    resolvedAt: "2026-10-29T10:17:00+08:00",
  },
];

/** Cash day for off-rail members (showcase 30 Oct 2026; judge clones shift it). */
export const cashDayIso = "2026-10-30T08:00:00+08:00";
