// The nine members named in register §2, with their exact kilos. Their nets are not typed here:
// the engine computes them, and canonical.test.ts checks every one to the cent.
import type { Lang } from "@fairsplit/contracts";

export interface SlipSpec {
  /** Fixed serial for hero slips; null when the generator assigns one. */
  serial: string | null;
  payableG: number;
  grade: "G1" | "G2";
  plotNo: string;
  station?: "BODEGA" | "PUROK_2" | "PUROK_4";
  /** Box 13 lines, verbatim, with what AI-6 classifies them as. */
  marks?: { text: string; ruleId: string; documentRef?: string | null }[];
  artifacts?: "WATER_STAIN"[];
  /** Overrides the default sack/tare when the spec fixes it (slip 0462: 1 PP, 0.30 tare). */
  tareG?: number;
}

export interface NamedMember {
  memberNo: string;
  displayName: string;
  nickname: string | null;
  consoleName: string;
  addressAs: Record<Lang, string>;
  nameOnSlip: string;
  gender: "F" | "M";
  lang: Lang;
  rail: "PAYPAL" | "CASH";
  receiverKind: "SANDBOX_ACCOUNT" | "NO_PAYPAL_ACCOUNT" | "NONE";
  signsWith: "SIGNATURE" | "THUMBMARK";
  audioFirst: boolean;
  demoRole: string;
  plots: { plotNo: string; areaHa: string; trees: number; registered: boolean }[];
  cbuPaidUpCentavos: number;
  loans: { ref: string; outstandingCentavos: number; authorityToDeduct: boolean }[];
  advances: { voucherNo: string | null; outstandingCentavos: number }[];
  slips: SlipSpec[];
}

const g = (kg: string) => Math.round(Number(kg) * 1000);

export const NAMED: NamedMember[] = [
  {
    memberNo: "M-014",
    displayName: "Consolacion Bacus",
    nickname: "Celing",
    consoleName: "Nang Celing",
    addressAs: { ceb: "Nang Celing", fil: "Gng. Bacus", en: "Mrs. Bacus" },
    nameOnSlip: "CONSOLACION BACUS",
    gender: "F",
    lang: "ceb",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: true,
    demoRole: "Hero line: premium, bonus and CBU; taps slip 0403 (MM-7)",
    plots: [{ plotNo: "P-014-A", areaHa: "0.36", trees: 200, registered: true }],
    cbuPaidUpCentavos: 385_000,
    loans: [],
    advances: [],
    slips: [
      { serial: "0403", payableG: g("38.45"), grade: "G1", plotNo: "P-014-A" },
      { serial: "0419", payableG: g("36.80"), grade: "G1", plotNo: "P-014-A" },
      { serial: "0436", payableG: g("35.25"), grade: "G1", plotNo: "P-014-A" },
      { serial: "0467", payableG: g("37.50"), grade: "G1", plotNo: "P-014-A" },
    ],
  },
  {
    memberNo: "M-007",
    displayName: "Dionisio Lapinig",
    nickname: "Dioning",
    consoleName: "Nong Dioning",
    addressAs: { ceb: "Nong Dioning", fil: "G. Lapinig", en: "Mr. Lapinig" },
    nameOnSlip: "DIONISIO LAPINIG",
    gender: "M",
    lang: "ceb",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "H1: slip 0457 photographed twice (white in B, pink in D)",
    plots: [{ plotNo: "P-007-A", areaHa: "0.40", trees: 220, registered: true }],
    cbuPaidUpCentavos: 240_000,
    loans: [],
    advances: [],
    slips: [
      { serial: "0457", payableG: g("42.00"), grade: "G1", plotNo: "P-007-A" },
      { serial: null, payableG: g("34.50"), grade: "G1", plotNo: "P-007-A" },
      { serial: null, payableG: g("33.20"), grade: "G1", plotNo: "P-007-A" },
      { serial: null, payableG: g("34.30"), grade: "G1", plotNo: "P-007-A" },
    ],
  },
  {
    memberNo: "M-060",
    displayName: "Arnel Sumampao",
    nickname: null,
    consoleName: "Arnel Sumampao",
    addressAs: { ceb: "Nong Arnel", fil: "G. Sumampao", en: "Mr. Sumampao" },
    nameOnSlip: "ARNEL SUMAMPAO",
    gender: "M",
    lang: "fil",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "Field 0462 entered by hand; logbook page 14, line 7 reads 64.50",
    plots: [{ plotNo: "P-060-A", areaHa: "0.33", trees: 180, registered: true }],
    cbuPaidUpCentavos: 110_000,
    loans: [],
    advances: [],
    slips: [
      {
        serial: "0462",
        payableG: g("64.50"),
        grade: "G1",
        plotNo: "P-060-A",
        tareG: 300,
        artifacts: ["WATER_STAIN"],
      },
      { serial: null, payableG: g("31.60"), grade: "G1", plotNo: "P-060-A" },
      { serial: null, payableG: g("32.40"), grade: "G1", plotNo: "P-060-A" },
    ],
  },
  {
    memberNo: "M-018",
    displayName: "Teodoro Pacaña",
    nickname: "Tidoy",
    consoleName: "Nong Tidoy",
    addressAs: { ceb: "Nong Tidoy", fil: "G. Pacaña", en: "Mr. Pacaña" },
    nameOnSlip: "TEODORO PACAÑA",
    gender: "M",
    lang: "ceb",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "H3: ₱200 multa returned as a credit; hauling ₱91.20 (R2) stays",
    plots: [{ plotNo: "P-018-A", areaHa: "0.30", trees: 165, registered: true }],
    cbuPaidUpCentavos: 420_000,
    loans: [],
    advances: [],
    slips: [
      {
        serial: "0458",
        payableG: g("60.80"),
        grade: "G1",
        plotNo: "P-018-A",
        station: "PUROK_2",
        marks: [
          { text: "Hauling ₱91.20", ruleId: "R2" },
          { text: "Multa (absent GA) ₱200", ruleId: "NO_MATCH" },
        ],
      },
      { serial: null, payableG: g("29.85"), grade: "G1", plotNo: "P-018-A" },
      { serial: null, payableG: g("29.75"), grade: "G1", plotNo: "P-018-A" },
    ],
  },
  {
    memberNo: "M-039",
    displayName: "Jonathan Ripalda",
    nickname: null,
    consoleName: "Jonathan Ripalda",
    addressAs: { ceb: "Nong Jonathan", fil: "G. Ripalda", en: "Mr. Ripalda" },
    nameOnSlip: "JONATHAN RIPALDA",
    gender: "M",
    lang: "en",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "On-rail member, English statement",
    plots: [{ plotNo: "P-039-A", areaHa: "0.25", trees: 130, registered: true }],
    cbuPaidUpCentavos: 90_000,
    loans: [],
    advances: [],
    slips: [
      { serial: null, payableG: g("30.15"), grade: "G1", plotNo: "P-039-A" },
      { serial: null, payableG: g("28.90"), grade: "G1", plotNo: "P-039-A" },
      { serial: null, payableG: g("28.95"), grade: "G1", plotNo: "P-039-A" },
    ],
  },
  {
    memberNo: "M-022",
    displayName: "Pedro Ompad",
    nickname: "Pedring",
    consoleName: "Nong Pedring",
    addressAs: { ceb: "Nong Pedring", fil: "G. Ompad", en: "Mr. Ompad" },
    nameOnSlip: "PEDRO OMPAD",
    gender: "M",
    lang: "ceb",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "Loan at the 50% cap (R3); the rest carried to next season",
    plots: [{ plotNo: "P-022-A", areaHa: "0.30", trees: 160, registered: true }],
    cbuPaidUpCentavos: 500_000,
    loans: [{ ref: "ATD-2026-022", outstandingCentavos: 40_000, authorityToDeduct: true }],
    advances: [],
    slips: [
      { serial: null, payableG: g("41.20"), grade: "G1", plotNo: "P-022-A" },
      { serial: null, payableG: g("38.80"), grade: "G1", plotNo: "P-022-A" },
      { serial: null, payableG: g("16.50"), grade: "G2", plotNo: "P-022-A" },
    ],
  },
  {
    memberNo: "M-002",
    displayName: "Florencia Ybañez",
    nickname: "Ciay",
    consoleName: "Nang Ciay",
    addressAs: { ceb: "Nang Ciay", fil: "Gng. Ybañez", en: "Mrs. Ybañez" },
    nameOnSlip: "FLORENCIA YBAÑEZ",
    gender: "F",
    lang: "ceb",
    rail: "PAYPAL",
    receiverKind: "SANDBOX_ACCOUNT",
    signsWith: "THUMBMARK",
    audioFirst: true,
    demoRole: "Signs with a thumbmark; audio first",
    plots: [{ plotNo: "P-002-A", areaHa: "0.22", trees: 120, registered: true }],
    cbuPaidUpCentavos: 295_000,
    loans: [],
    advances: [],
    slips: [
      { serial: null, payableG: g("31.05"), grade: "G1", plotNo: "P-002-A" },
      { serial: null, payableG: g("28.95"), grade: "G1", plotNo: "P-002-A" },
      { serial: null, payableG: g("14.00"), grade: "G2", plotNo: "P-002-A" },
    ],
  },
  {
    memberNo: "M-031",
    displayName: "Rhea Jumawan",
    nickname: null,
    consoleName: "Rhea Jumawan",
    addressAs: { ceb: "Nang Rhea", fil: "Gng. Jumawan", en: "Mrs. Jumawan" },
    nameOnSlip: "RHEA JUMAWAN",
    gender: "F",
    lang: "en",
    rail: "PAYPAL",
    receiverKind: "NO_PAYPAL_ACCOUNT",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "The unclaimed case (C-07): her address has no PayPal account; paid in cash",
    plots: [{ plotNo: "P-031-A", areaHa: "0.20", trees: 100, registered: true }],
    cbuPaidUpCentavos: 60_000,
    loans: [],
    advances: [],
    slips: [
      { serial: null, payableG: g("30.70"), grade: "G1", plotNo: "P-031-A" },
      { serial: null, payableG: g("30.50"), grade: "G1", plotNo: "P-031-A" },
    ],
  },
  {
    memberNo: "M-053",
    displayName: "Merlyn Ponce",
    nickname: null,
    consoleName: "Merlyn Ponce",
    addressAs: { ceb: "Nang Merlyn", fil: "Gng. Ponce", en: "Mrs. Ponce" },
    nameOnSlip: "MERLYN PONCE",
    gender: "F",
    lang: "ceb",
    rail: "CASH",
    receiverKind: "NONE",
    signsWith: "SIGNATURE",
    audioFirst: false,
    demoRole: "H2: 300.0 kg from 140 registered trees; registers plot P-053-B (0.60 ha, 330 trees)",
    plots: [
      { plotNo: "P-053-A", areaHa: "0.25", trees: 140, registered: true },
      { plotNo: "P-053-B", areaHa: "0.60", trees: 330, registered: false },
    ],
    cbuPaidUpCentavos: 180_000,
    loans: [],
    advances: [],
    slips: [
      { serial: "0471", payableG: g("41.20"), grade: "G1", plotNo: "P-053-B" },
      { serial: null, payableG: g("39.85"), grade: "G1", plotNo: "P-053-A" },
      { serial: null, payableG: g("40.30"), grade: "G1", plotNo: "P-053-B" },
      { serial: null, payableG: g("38.65"), grade: "G1", plotNo: "P-053-A" },
      { serial: null, payableG: g("40.10"), grade: "G1", plotNo: "P-053-B" },
      { serial: null, payableG: g("39.40"), grade: "G1", plotNo: "P-053-A" },
      { serial: null, payableG: g("40.50"), grade: "G1", plotNo: "P-053-B" },
      { serial: null, payableG: g("20.00"), grade: "G2", plotNo: "P-053-A" },
    ],
  },
];

/**
 * Pool shares the register's lines imply for the named members (largest remainder over the
 * final totals: 9,780.6 kg verified, 9,388.0 kg Grade 1). The background tuner searches until the
 * rounding lands exactly here; the engine then computes the nets from these shares.
 */
export const NAMED_SHARE_TARGETS: Record<string, { premiumCents: number; bonusCents: number }> = {
  "M-014": { premiumCents: 4369, bonusCents: 2185 },
  "M-007": { premiumCents: 4251, bonusCents: 2126 },
  "M-060": { premiumCents: 3794, bonusCents: 1897 },
  "M-018": { premiumCents: 3555, bonusCents: 1777 },
  "M-039": { premiumCents: 2598, bonusCents: 1299 },
  "M-022": { premiumCents: 2849, bonusCents: 1181 },
  "M-002": { premiumCents: 2185, bonusCents: 886 },
  "M-031": { premiumCents: 1807, bonusCents: 903 },
  "M-053": { premiumCents: 8857, bonusCents: 4134 },
};

/** With slip 0457 counted twice (9,822.6 kg; 9,430.0 kg Grade 1), Nong Dioning's shares. */
export const DUPLICATE_SHARE_TARGET = { memberNo: "M-007", premiumCents: 5468, bonusCents: 2734 } as const;
