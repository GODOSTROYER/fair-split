/**
 * The demo fixture (IC-03): the seed's run r37 for everything a signature binds, and a local fixture for the rest.
 *
 * - The co-sign run is the seed snapshot's (`packages/seed/snapshot/season-2026A.json`, WS-CORE), copied into
 *   `seed-run.json` by `scripts/seed-run.mjs` because the app may not import @fairsplit/seed (register §6): run and
 *   season IDs, the rate card hash, the eight PayPal items and all 64 member lines with the content each line hash
 *   covers. `scripts/seed-run.test.mjs` fails when the copy and the snapshot differ. The batch hash and the lines
 *   digest are computed here with WS-CORE's functions (`domain-core.ts`), never typed, and equal the seed's, so the
 *   phone's seal is the console's.
 * - The rest is a local fixture until the screens read the seed through fs-api: the hero line (register §2, M-014),
 *   the statement templates, the resolved holds and the canonical figures, copied from register §2 to the cent. Slips
 *   0419, 0436 and 0467 are `provisional` (the register fixes only slip 0403, 38.45 kg, and the 148.0 kg total) and
 *   are labelled as samples in the UI.
 */
import type { CosignLine } from "./api-client";
import type { BatchItem, HoldKind, Lang, StatementTemplate } from "./contracts";
import { batchDigest, linesDigest as digestLines } from "./domain";
import seedRunJson from "./seed-run.json";

/** `seed-run.json`'s shape: what `scripts/seed-run.mjs` copies from the snapshot (checked by its test). */
interface SeedRun {
  runId: string;
  runSlug: string;
  seasonId: string;
  rateCardSha256: string;
  senderBatchId: string;
  items: readonly (BatchItem & { memberNo: string })[];
  lines: readonly CosignLine[];
}
const seedRun = seedRunJson as unknown as SeedRun;

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
/** The seed's run and season IDs (UUIDv7): the approval payload's `runId` and `seasonId`. */
export const runId = seedRun.runId;
export const seasonId = seedRun.seasonId;

export const people = {
  /** `fs-analyn-w1`: the treasurer's non-extractable WebCrypto key, registered from /ops (approved plan). */
  treasurer: {
    name: "Analyn R. Sumalinog",
    first: "Analyn",
    initials: "AS",
    keyId: "fs-analyn-w1",
    keyKind: "web",
    approverId: "treasurer:analyn",
  },
  /** `fs-ernesto-a1`: the Chair's app key, in SecureStore behind his fingerprint (register §8, C-13). */
  chair: {
    name: "Ernesto P. Cabahug",
    first: "Ernesto",
    initials: "EC",
    keyId: "fs-ernesto-a1",
    keyKind: "app",
    approverId: "board:ernesto",
  },
  clerk: { name: "Jessie D. Dumaguing", first: "Jessie", initials: "JD" },
} as const;

/** BR 2026-04, Schedule A (design §0), as the screens describe it. Its hash is the seed's card hash, below. */
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

/** The ratified card's hash (`rc:{sha16}` on the invoice): every line hash and the batch hash cover it. */
export const rateCardSha256 = seedRun.rateCardSha256;
/** `{season}-{rc8}-r{runSeq}` (register §8). */
export const senderBatchId = seedRun.senderBatchId;

/** Run r37's eight PayPal items (register §2): the batch the Chair co-signs. Receivers are the seed's aliases. */
export const batchItems: readonly BatchItem[] = seedRun.items.map(
  ({ senderItemId, receiver, amountCents, currency }) => ({
    senderItemId,
    receiver,
    amountCents,
    currency,
  }),
);

/** batchSha256 (register §8), computed here with WS-CORE's `batchDigest`: the seed's, so the console's too. */
export const batchSha256 = batchDigest({ runId, senderBatchId, rateCardSha256 }, batchItems).batchSha256;
export const batchTotalCents = batchItems.reduce((s, i) => s + i.amountCents, 0);

/**
 * Every member line of the run, PayPal and cash (8 + 56), with the content its hash covers: what both keys bind
 * through `linesDigest` (approved plan), and what the co-sign request and the approval payload carry.
 */
export const runLines: readonly CosignLine[] = seedRun.lines;

/** The approved plan's `linesDigest` over all 64 lines, computed with WS-CORE's function: the seed's. */
export const linesDigest = digestLines(runLines);

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
 * AI_NOTE copies T1's seeded, seeded_noname and seeded_checking forms from fs-api's templates.ts; these demo
 * readings are stand-ins. Cebuano and Filipino remain machine-translated, pending native review (OD-2).
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
      variant: "seeded",
      text: "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan ni Treasurer {{TREASURER}} kini nga bayad.",
    },
    {
      id: "ai-note-noname",
      slot: "AI_NOTE",
      variant: "seeded_noname",
      text: "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo, ug giaprobahan sa tesorero kini nga bayad.",
    },
    {
      id: "ai-note-checking",
      slot: "AI_NOTE",
      variant: "seeded_checking",
      text: "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo.",
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
      variant: "seeded",
      text: "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak, at inaprubahan ni Treasurer {{TREASURER}} ang bayad na ito.",
    },
    {
      id: "ai-note-noname",
      slot: "AI_NOTE",
      variant: "seeded_noname",
      text: "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak, at inaprubahan ng ingat-yaman ang bayad na ito.",
    },
    {
      id: "ai-note-checking",
      slot: "AI_NOTE",
      variant: "seeded_checking",
      text: "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak.",
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
      variant: "seeded",
      text: "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and Treasurer {{TREASURER}} approved this pay.",
    },
    {
      id: "ai-note-noname",
      slot: "AI_NOTE",
      variant: "seeded_noname",
      text: "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and the treasurer approved this pay.",
    },
    {
      id: "ai-note-checking",
      slot: "AI_NOTE",
      variant: "seeded_checking",
      text: "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones.",
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

/* ------------------------------------------------------------------ canonical figures (register §2) */

/**
 * The season's money and kilos, in integer US cents and grams, exactly as register §2 states them. The seed's
 * `canonical.test.ts` checks these to the cent; the app's own test checks that they reconcile (money is conserved,
 * I3). Screens read them from here, never from a literal.
 */
export const canonical = {
  invoice: { totalCents: 433350, premiumCents: 288750, bonusCents: 138600, disbursementCents: 6000 },
  lot: {
    id: season.lot,
    sacks: 154,
    shippedGrams: 9_625_000,
    shippedGrade1Grams: 9_240_000,
    shippedOn: "2026-09-18",
  },
  kilos: {
    verifiedGrams: 9_780_600,
    verifiedGrade1Grams: 9_388_000,
    /** Shrink against the shipped lot, in basis points: 1.62%, or 2.05% if slip 0457 counted twice. */
    shrinkBp: 162,
    shrinkDoubleCountedBp: 205,
    massBalanceToleranceBp: 200,
  },
  lines: {
    count: 64,
    grossCents: 427350,
    deductionsCents: 5853,
    creditsCents: 320,
    netCents: 421817,
    paypal: { members: 8, cents: 36839 },
    cash: { members: 56, cents: 384978 },
  },
  redirected: { totalCents: 2114, duplicateSlipCents: 1794, multaReturnedCents: 320 },
  /** After Rhea's item parks UNCLAIMED and moves to cash. */
  endState: { paypal: { members: 7, cents: 34174 }, cash: { members: 57, cents: 387643 } },
  fees: {
    publishedUsPerItemCents: 25,
    publishedUsTotalCents: 200,
    productionPhBp: 200,
    productionPhCents: 737,
  },
} as const;

export type MemberRail = "PAYPAL" | "CASH" | "PAYPAL_THEN_CASH";

export interface NamedMember {
  memberNo: string;
  name: string;
  /** What the statement calls the member, by language (honorifics Nang, Nong; po in Filipino). */
  nameByLang: Readonly<Record<Lang, string>>;
  lang: Lang;
  rail: MemberRail;
  grams: number;
  /** Grade 1 kilos where the register states them. */
  grade1Grams: number | null;
  netCents: number;
  /** The member's part in the demo, in the register's words. */
  role: string;
}

/** The nine named members of register §2; the seed's 55 background members are not in the app's fixture. */
export const namedMembers: readonly NamedMember[] = [
  {
    memberNo: "M-014",
    name: "Consolacion Bacus",
    nameByLang: { ceb: "Nang Celing", fil: "Gng. Bacus", en: "Mrs. Bacus" },
    lang: "ceb",
    rail: "PAYPAL",
    grams: 148_000,
    grade1Grams: 148_000,
    netCents: 6445,
    role: "Hero line: 43.69 + 21.85 − CBU 1.09. Slips 0403, 0419, 0436, 0467",
  },
  {
    memberNo: "M-007",
    name: "Dionisio Lapinig",
    nameByLang: { ceb: "Nong Dioning", fil: "G. Lapinig", en: "Mr. Lapinig" },
    lang: "ceb",
    rail: "PAYPAL",
    grams: 144_000,
    grade1Grams: null,
    netCents: 6271,
    role: "H1: 80.65 with the duplicate slip 0457, 62.71 counted once",
  },
  {
    memberNo: "M-060",
    name: "Arnel Sumampao",
    nameByLang: { ceb: "Arnel", fil: "G. Sumampao", en: "Mr. Sumampao" },
    lang: "fil",
    rail: "PAYPAL",
    grams: 128_500,
    grade1Grams: null,
    netCents: 5596,
    role: "Field 0462 entered by hand; logbook page 14, line 7 reads 64.50",
  },
  {
    memberNo: "M-018",
    name: "Teodoro Pacaña",
    nameByLang: { ceb: "Nong Tidoy", fil: "G. Pacaña", en: "Mr. Pacaña" },
    lang: "ceb",
    rail: "PAYPAL",
    grams: 120_400,
    grade1Grams: null,
    netCents: 5563,
    role: "H3: the ₱200 multa returned as +3.20; hauling ₱91.20 stays",
  },
  {
    memberNo: "M-039",
    name: "Jonathan Ripalda",
    nameByLang: { ceb: "Jonathan", fil: "G. Ripalda", en: "Mr. Ripalda" },
    lang: "en",
    rail: "PAYPAL",
    grams: 88_000,
    grade1Grams: null,
    netCents: 3832,
    role: "—",
  },
  {
    memberNo: "M-022",
    name: "Pedro Ompad",
    nameByLang: { ceb: "Nong Pedring", fil: "G. Ompad", en: "Mr. Ompad" },
    lang: "ceb",
    rail: "PAYPAL",
    grams: 96_500,
    grade1Grams: 80_000,
    netCents: 3440,
    role: "Loan −5.90 at the 50% cap; ₱31.25 carried to next season",
  },
  {
    memberNo: "M-002",
    name: "Florencia Ybañez",
    nameByLang: { ceb: "Nang Ciay", fil: "Gng. Ybañez", en: "Mrs. Ybañez" },
    lang: "ceb",
    rail: "PAYPAL",
    grams: 74_000,
    grade1Grams: 60_000,
    netCents: 3027,
    role: "Signs with a thumbmark; audio first",
  },
  {
    memberNo: "M-031",
    name: "Rhea Jumawan",
    nameByLang: { ceb: "Rhea", fil: "Bb. Jumawan", en: "Ms. Jumawan" },
    lang: "en",
    rail: "PAYPAL_THEN_CASH",
    grams: 61_200,
    grade1Grams: null,
    netCents: 2665,
    role: "The unclaimed case (C-07): parked, then paid in cash at the bodega",
  },
  {
    memberNo: "M-053",
    name: "Merlyn Ponce",
    nameByLang: { ceb: "Nang Merlyn", fil: "Gng. Ponce", en: "Mrs. Ponce" },
    lang: "ceb",
    rail: "CASH",
    grams: 300_000,
    grade1Grams: 280_000,
    netCents: 12784,
    role: "H2: 140 trees, so she registers plot P-053-B (0.60 ha, 330 trees); collects exactly ₱7,990.00",
  },
];
