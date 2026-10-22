/**
 * TEMPORARY SHIM: replace with the @fairsplit/seed snapshot (`packages/seed/snapshot/season-2026A.json`, IC-03)
 * after WS-CORE merges.
 *
 * A local fixture for the hero line (register §2, M-014) and the co-sign batch, so the app renders realistic data
 * before the seed lands. Figures copy register §2 to the cent. Hashes are computed here, never typed.
 * Values marked `provisional` are NOT in the register (only slip 0403's 38.45 kg and the 148.0 kg total are);
 * they exist so the slip list has rows, sum to the register's total, and are replaced by the seed.
 */
import type { BatchItem, HoldKind, Lang } from "./contracts";
import { batchDigest, jcs, sha256Hex } from "./domain";

export const coop = { name: "Bulawanon Kakaw Growers MPC", place: "Calinan, Davao City" } as const;
export const season = { code: "2026-A", id: "2026A", lot: "LB-PH-2026-03" } as const;
export const payer = { name: "Lantern Bay Chocolate Co.", short: "Lantern Bay" } as const;
export const fx = { phpPerUsd: "62.50" } as const;
export const runSeq = 37;
export const runSlug = `${season.id}-r${runSeq}`;
export const runId = "run_2026A_r37_fixture";

export const people = {
  treasurer: { name: "Analyn R. Sumalinog", first: "Analyn", initials: "AS", keyId: "fs-analyn-a1" },
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

export interface SlipFixture {
  serial: string;
  netGrams: number;
  deliveredOn: string;
  photo: string;
  provisional: boolean;
}

/** M-014's slips: 0403 is 38.45 kg (register §2); the others are provisional and sum to 148.0 kg. */
export const heroSlips: readonly SlipFixture[] = [
  {
    serial: "0403",
    netGrams: 38450,
    deliveredOn: "2026-05-12T09:20:00+08:00",
    photo: "B",
    provisional: false,
  },
  {
    serial: "0419",
    netGrams: 36900,
    deliveredOn: "2026-06-09T10:05:00+08:00",
    photo: "C",
    provisional: true,
  },
  {
    serial: "0436",
    netGrams: 37150,
    deliveredOn: "2026-07-07T08:40:00+08:00",
    photo: "F",
    provisional: true,
  },
  {
    serial: "0467",
    netGrams: 35500,
    deliveredOn: "2026-08-11T09:55:00+08:00",
    photo: "H",
    provisional: true,
  },
];

export const heroLine = {
  memberNo: "M-014",
  displayName: "Consolacion Bacus",
  nameByLang: { ceb: "Nang Celing", fil: "Gng. Bacus", en: "Mrs. Bacus" } satisfies Record<Lang, string>,
  lang: "ceb" as Lang,
  /** Paminawa takes first focus for members flagged as elderly (design §8). */
  audioFirst: true,
  rail: "PAYPAL" as const,
  netGrams: 148000,
  grade1Grams: 148000,
  premiumCents: 4369,
  bonusCents: 2185,
  deductions: [{ ruleId: "R1", label: "CBU", cents: 109 }] as const,
  creditsCents: 0,
  netCents: 6445,
  /** Display rates as the engine prints them (S1.10 "US$0.29523 a kg"); computed server-side, never here. */
  premiumRatePerKg: "0.29523",
  senderItemId: `r${runSeq}-M-014`,
} as const;

/** Sentence templates (S1.10, AI-8's target): words and placeholders, no digits, one sentence per audio clip. */
export const statementSentences: Readonly<Record<Lang, readonly { id: string; text: string }[]>> = {
  ceb: [
    { id: "s1", text: "Maayong adlaw, {{NAME}}. Salamat sa inyong paghago." },
    { id: "s2", text: "Nagdala mo og {{NET_KG}} nga uga nga cacao, tanan {{GRADE}}." },
    { id: "s3", text: "Premium gikan sa {{PAYER}}: {{PREMIUM}}, walay kaltas." },
    { id: "s4", text: "Bonus sa kalidad: {{BONUS}}, gikaltasan og {{CBU}} para sa CBU ({{RULE}}, {{BR}})." },
    { id: "s5", text: "Ang inyong bayad karong season: {{NET}}, mga {{NET_PHP}}, pinaagi sa PayPal." },
    { id: "s6", text: "Gikan kini sa inyong resibo {{SLIPS}}." },
    { id: "s7", text: "Naa moy pangutana? Adto kang Treasurer {{TREASURER}} sa bodega." },
  ],
  fil: [
    { id: "s1", text: "Magandang araw po, {{NAME}}. Salamat po sa inyong pagsisikap." },
    { id: "s2", text: "Nagdala po kayo ng {{NET_KG}} na tuyong cacao, lahat {{GRADE}}." },
    { id: "s3", text: "Premium mula sa {{PAYER}}: {{PREMIUM}}, walang kaltas." },
    { id: "s4", text: "Bonus sa kalidad: {{BONUS}}, binawasan ng {{CBU}} para sa CBU ({{RULE}}, {{BR}})." },
    {
      id: "s5",
      text: "Ang inyong bayad ngayong season: {{NET}}, humigit-kumulang {{NET_PHP}}, sa PayPal.",
    },
    { id: "s6", text: "Galing po ito sa inyong mga resibo {{SLIPS}}." },
    { id: "s7", text: "May tanong po kayo? Lumapit po kay Treasurer {{TREASURER}} sa bodega." },
  ],
  en: [
    { id: "s1", text: "Good day, {{NAME}}. Thank you for your hard work." },
    { id: "s2", text: "You delivered {{NET_KG}} of dried cacao, all {{GRADE}}." },
    { id: "s3", text: "Premium from {{PAYER}}: {{PREMIUM}}, no deductions allowed." },
    { id: "s4", text: "Quality bonus: {{BONUS}}, less {{CBU}} for capital build-up ({{RULE}}, {{BR}})." },
    { id: "s5", text: "Your pay this season: {{NET}}, about {{NET_PHP}}, by PayPal." },
    { id: "s6", text: "It comes from your slips {{SLIPS}}." },
    { id: "s7", text: "Questions? See Treasurer {{TREASURER}} at the bodega." },
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
