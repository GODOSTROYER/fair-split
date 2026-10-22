// Small hand-built worlds for domain tests (domain cannot import the seed package).
import type {
  EngineInput,
  EngineMember,
  EngineRow,
  Lot,
  RateCardCanonical,
  RatifiedRateCard,
} from "@fairsplit/contracts";
import { ratifyRateCard } from "../ratecard.js";

export const TEST_RULES: RateCardCanonical["rules"] = {
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
};

export function testCanonical(overrides: Partial<RateCardCanonical> = {}): RateCardCanonical {
  return {
    v: 1,
    season: "2026A",
    resolutionNo: "BR TEST",
    ratifiedOn: "2026-03-14",
    gaCitation: { resolutionNo: "GA TEST", approvedOn: "2026-02-28" },
    pricing: {
      buyer: "Test Buyer",
      currency: "USD",
      premiumCentsPerShippedKg: 30,
      bonusCentsPerShippedGrade1Kg: 15,
      disbursementCents: 6_000,
    },
    rules: TEST_RULES,
    terms: [
      {
        ruleId: "R0",
        pool: "PREMIUM",
        kind: "SHARE",
        basis: "VERIFIED_KG",
        label: "Premium",
        valueAsWritten: "verified kilos",
        capAsWritten: "",
        conditionAsWritten: "",
        requiresDocument: "NONE",
        source: { page: 1, quote: "The premium shall be shared in proportion to verified kilos." },
      },
    ],
    documents: [],
    ...overrides,
  };
}

export function testCard(overrides: Partial<RateCardCanonical> = {}): RatifiedRateCard {
  return ratifyRateCard(testCanonical(overrides), "2026-03-14T08:00:00.000Z", []);
}

export const TEST_LOT: Lot = {
  lotCode: "LOT-TEST",
  shippedG: 1_000_000,
  grade1ShippedG: 900_000,
  sacks: 16,
  sackKind: "jute",
  shippedOn: "2026-09-18",
};

export function member(memberNo: string, extra: Partial<EngineMember> = {}): EngineMember {
  return {
    memberNo,
    rail: "CASH",
    registeredTrees: 1_000,
    cbuPaidUpCentavos: 0,
    loans: [],
    advances: [],
    ...extra,
  };
}

let rowCounter = 0;

export function row(memberNo: string, kg: number, extra: Partial<EngineRow> = {}): EngineRow {
  rowCounter += 1;
  const serial = extra.serial ?? String(300 + rowCounter).padStart(4, "0");
  const grams = Math.round(kg * 1000);
  return {
    rowId: `row-${serial}-${extra.copy ?? "WHITE_ORIGINAL"}`,
    documentId: `doc-${serial}`,
    photoId: null,
    serial,
    copy: "WHITE_ORIGINAL",
    memberNo,
    slipDate: "2026-05-01",
    station: "BODEGA",
    netG: grams,
    payableG: grams,
    grade: "G1",
    plotNo: null,
    pendingFields: [],
    enteredByHand: false,
    marks: [],
    anomalies: [],
    ...extra,
  };
}

export function input(
  members: EngineMember[],
  rows: EngineRow[],
  extra: Partial<EngineInput> = {},
): EngineInput {
  return {
    card: testCard(),
    lot: TEST_LOT,
    fx: { num: 125, den: 2 },
    members,
    rows,
    nearDuplicates: [],
    resolutions: [],
    priorHolds: [],
    ...extra,
  };
}

export const AT = "2026-10-29T02:00:00.000Z";
