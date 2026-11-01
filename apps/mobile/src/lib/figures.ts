/**
 * Every figure on the member's statement (M-MB-01, M-MB-02, MM-7), derived from the statement DTO and formatted by
 * `format.*` (I1, C-22). Screens render these strings and never compute, round or type a number of their own:
 * - the hero amount: US$ for a PayPal line, exact pesos at the run's recorded rate for cash (S1.9);
 * - the receipt rows in reading order: premium, bonus, ruled deductions, credits, net (design §5 ReceiptBar);
 * - the share wording ("Your 148.0 kg of the co-op's 9,780.6 verified kilos"; members never see a per-kg rate);
 * - the fee note rates from `FEE_TABLE` (PayPal's conversion and GCash's transfer are not co-op deductions);
 * - slip kilos, dates and their sum, which must equal the line's kilos;
 * - MM-7's traces: what each tapped amount comes from, down to the slips (`traceFor`).
 *
 * `lineConservation` re-adds the line on the phone (I3): premium + bonus − deductions + credits must equal the net,
 * to the cent. A line that does not add up is never presented as settled: the statement's `lineView` keeps its
 * amount hollow (never landed or attested, and MM-1 does not fill it) under a "Gisusi pa" sentence naming the
 * treasurer, and the net trace says it does not add up.
 */
import type { StatementDTO, StatementSlip } from "../_shims/api-client";
import type { Lang } from "../_shims/contracts";
import { FEE_TABLE, format } from "../_shims/domain";

/* ------------------------------------------------------------------ receipt rows */

export type ReceiptKind = "premium" | "bonus" | "deduction" | "credit" | "net";
/** A tappable receipt segment (MM-7 traces any of them; the film taps the premium). */
export type ReceiptId = "premium" | "bonus" | "net" | `ded:${string}` | `credit:${string}`;

export interface ReceiptRow {
  id: ReceiptId;
  kind: ReceiptKind;
  /** Signed cents as the line adds up: deductions are negative. */
  cents: number;
  /** "43.69", "−1.09", "+3.20"; the net carries its currency: "US$64.45". */
  amount: string;
  /** The full spoken amount for screen readers: "minus one dollar and nine cents". */
  spoken: string;
  /** Deductions: the ratified rule ("R1") and its label ("CBU"). */
  ruleId?: string;
  label?: string;
  /** Credits: the slip the unruled deduction was written on, and the pesos written there (centavos). */
  slip?: string;
  writtenCentavos?: number;
}

export function receiptRows(dto: StatementDTO): ReceiptRow[] {
  if (dto.formatted) return dto.formatted.receiptRows;
  const a = dto.amounts;
  const rows: ReceiptRow[] = [
    {
      id: "premium",
      kind: "premium",
      cents: a.premiumCents,
      amount: format.usdPlain(a.premiumCents),
      spoken: format.amountSpoken(a.premiumCents),
    },
    {
      id: "bonus",
      kind: "bonus",
      cents: a.bonusCents,
      amount: format.usdPlain(a.bonusCents),
      spoken: format.amountSpoken(a.bonusCents),
    },
  ];
  for (const d of a.deductions) {
    rows.push({
      id: `ded:${d.ruleId}`,
      kind: "deduction",
      cents: -d.cents,
      amount: format.usdPlain(-d.cents),
      spoken: format.amountSpoken(-d.cents),
      ruleId: d.ruleId,
      label: d.label,
    });
  }
  for (const c of a.credits) {
    rows.push({
      id: `credit:${c.slip}`,
      kind: "credit",
      cents: c.cents,
      amount: `+${format.usdPlain(c.cents)}`,
      spoken: format.amountSpoken(c.cents),
      slip: c.slip,
      writtenCentavos: c.writtenCentavos,
    });
  }
  rows.push({
    id: "net",
    kind: "net",
    cents: a.netCents,
    amount: format.usd(a.netCents),
    spoken: format.amountSpoken(a.netCents),
  });
  return rows;
}

/** The pesos written on a slip for a returned multa: "₱200" (whole pesos drop their centavos). */
export function writtenPesos(centavos: number): string {
  return `₱${format.usdPlain(centavos).replace(/\.00$/, "")}`;
}

/**
 * The proportions of the receipt bar, in cents: what she keeps of the premium, of the bonus, what was deducted and
 * what came back. Pure layout weights for an `aria-hidden` drawing; the words and figures carry the meaning.
 */
export function receiptBarWeights(dto: StatementDTO): {
  premium: number;
  bonus: number;
  deducted: number;
  credited: number;
} {
  const a = dto.amounts;
  const deducted = a.deductions.reduce((s, d) => s + d.cents, 0);
  const credited = a.credits.reduce((s, c) => s + c.cents, 0);
  return { premium: a.premiumCents, bonus: Math.max(0, a.bonusCents - deducted), deducted, credited };
}

/* ------------------------------------------------------------------ conservation (I3) */

export interface Conservation {
  ok: boolean;
  /** premium + bonus − deductions + credits, in cents. */
  computedCents: number;
  netCents: number;
}

const isCents = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Money is conserved on the phone too: the receipt must add up to the net, in whole non-negative cents. */
export function lineConservation(dto: StatementDTO): Conservation {
  if (dto.formatted) return dto.formatted.conservation;
  const a = dto.amounts;
  const parts = [
    a.premiumCents,
    a.bonusCents,
    a.netCents,
    ...a.deductions.map((d) => d.cents),
    ...a.credits.map((c) => c.cents),
  ];
  const computedCents =
    a.premiumCents +
    a.bonusCents -
    a.deductions.reduce((s, d) => s + d.cents, 0) +
    a.credits.reduce((s, c) => s + c.cents, 0);
  return { ok: parts.every(isCents) && computedCents === a.netCents, computedCents, netCents: a.netCents };
}

/* ------------------------------------------------------------------ the hero amount */

export type PayKind = "paypal" | "cash";

/**
 * A line is paid in cash when its rail is cash, or when its PayPal item was returned and the line moved to the
 * bodega (Rhea's path; the capsule reads "Andam sa bodega" or "Nadawat").
 */
export function payKindOf(dto: StatementDTO, capsule?: string | null): PayKind {
  if (dto.rail === "CASH") return "cash";
  return capsule === "cash-due" || capsule === "cash-received" ? "cash" : "paypal";
}

export interface HeroFigures {
  kind: PayKind;
  cents: number;
  /** "US$64.45" (PayPal) or "₱4,028.13" (cash, exact at the run's rate). */
  amount: string;
  /** The full spoken amount, with the peso estimate or "cash". */
  spoken: string;
  /** PayPal: "mga ₱4,028 (gibanabana)", floored at the run rate. Cash: null (the amount is exact). */
  estimate: string | null;
  usd: string;
  /** "₱62.50": the run's recorded rate, for "₱62.50 matag dolyar". */
  rate: string;
}

export function heroFigures(dto: StatementDTO, lang: Lang, kind: PayKind): HeroFigures {
  const served = dto.formattedByLang?.[lang] ?? dto.formatted;
  if (served) return served.hero[kind];
  const net = dto.amounts.netCents;
  const r = dto.fx.phpPerUsd;
  if (kind === "cash") {
    return {
      kind,
      cents: net,
      amount: format.cashPesos(net, r),
      spoken: format.cashSpoken(net, r),
      estimate: null,
      usd: format.usd(net),
      rate: rateLabel(dto),
    };
  }
  return {
    kind,
    cents: net,
    amount: format.usd(net),
    spoken: format.amountSpoken(net, r),
    estimate: format.pesoEstimate(net, r, lang),
    usd: format.usd(net),
    rate: rateLabel(dto),
  };
}

/** The run's display rate, verbatim from the DTO: "₱62.50". */
export function rateLabel(dto: StatementDTO): string {
  return `₱${dto.fx.phpPerUsd}`;
}

/* ------------------------------------------------------------------ share wording, fees */

export interface ShareFigures {
  /** Her verified kilos: "148.0 kg". */
  kg: string;
  /** The co-op's verified kilos, the premium's denominator: "9,780.6 kg". */
  coopKg: string;
  /** Her Grade 1 kilos: "148.0 kg". */
  grade1Kg: string;
  allGrade1: boolean;
}

/** Members never see a per-kg rate (S2.2.1): the premium reads as her share of the co-op's verified kilos. */
export function shareFigures(dto: StatementDTO): ShareFigures {
  if (dto.formatted) return dto.formatted.share;
  const k = dto.kilos;
  return {
    kg: format.kg(k.netGrams),
    coopKg: format.kg(k.coopVerifiedGrams),
    grade1Kg: format.kg(k.grade1Grams),
    allGrade1: k.grade1Grams === k.netGrams,
  };
}

export interface FeeFigures {
  /** PayPal's conversion spread to pesos: "3%". */
  paypal: string;
  /** GCash's transfer fee: "1%". */
  gcash: string;
  paypalSource: string;
  gcashSource: string;
}

/** Published rates from `FEE_TABLE`; shown as rates with their sources, never computed into her line. */
export function feeFigures(): FeeFigures {
  return {
    paypal: format.percentBp(FEE_TABLE.paypalConversionBp),
    gcash: format.percentBp(FEE_TABLE.gcashTransferBp),
    paypalSource: FEE_TABLE.paypalSource,
    gcashSource: FEE_TABLE.gcashSource,
  };
}

/* ------------------------------------------------------------------ slips */

export interface SlipFigures {
  serial: string;
  /** "38.45 kg". */
  kg: string;
  /** "38.45": the figure as the clerk wrote it on the slip. */
  written: string;
  /** "2 Hun 2026". */
  date: string;
  /** Sample kilos (the register fixes only slip 0403); the UI labels them as such in demo data. */
  provisional: boolean;
}

export function slipFigures(slip: StatementSlip, lang: Lang): SlipFigures {
  const kg = format.kg(slip.netGrams, 2);
  return {
    serial: slip.serial,
    kg,
    written: kg.replace(/ kg$/, ""),
    date: format.date(slip.deliveredOn, lang),
    provisional: !!slip.provisional,
  };
}

/** Philippine time (UTC+8), the co-op's own clock, as `format.*` keeps it. */
const MANILA_MS = 8 * 60 * 60 * 1000;

/**
 * A delivery date as the clerk writes it on the slip template (slip-v1): "06/02/2026", month first, in the co-op's
 * time. Only the sample drawing of a slip uses it; every other date on screen comes from `format.date`.
 */
export function handwrittenDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + MANILA_MS);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

export interface SlipTotal {
  grams: number;
  /** "148.0 kg". */
  kg: string;
  /** The slips add up to the line's verified kilos (the four crops tile to "148.0 kg"). */
  matchesLine: boolean;
}

export function slipTotal(dto: StatementDTO): SlipTotal {
  const grams = dto.slips.reduce((s, x) => s + x.netGrams, 0);
  return { grams, kg: format.kg(grams), matchesLine: grams === dto.kilos.netGrams };
}

/* ------------------------------------------------------------------ rules before facts (I2) */

/**
 * True when the Board ratified the rate card before her first slip was weighed: the deduction she sees was fixed
 * before any of her kilos existed (invariant I2, "rules are frozen before facts"). False when it cannot be shown.
 */
export function ratifiedBeforeFirstSlip(dto: StatementDTO): boolean {
  const ratified = Date.parse(dto.rateCard.ratifiedAt);
  const first = Math.min(...dto.slips.map((s) => Date.parse(s.deliveredOn)));
  return Number.isFinite(ratified) && Number.isFinite(first) && ratified < first;
}

/* ------------------------------------------------------------------ MM-7 traces */

/**
 * The rule that protects the premium (BR 2026-04, Schedule A R0: "Premium is paid by verified kilos and is never
 * deducted"). A rate-card constant, not a figure.
 */
export const PREMIUM_RULE = "R0";

/** One term of the line's sum as the net trace prints it: "43.69", "+ 21.85", "− 1.09". */
export interface EquationTerm {
  op: "+" | "−" | null;
  amount: string;
}

export type TraceId = ReceiptId | "fees";

/** What a tapped amount comes from (MM-7). Every string is formatted from the DTO; copy wraps it in words. */
export type Trace =
  | { id: "premium"; kg: string; coopKg: string; rule: string; slips: readonly string[] }
  | { id: "bonus"; grade1Kg: string; allGrade1: boolean; slips: readonly string[] }
  | {
      id: `ded:${string}`;
      label: string;
      rule: string;
      card: string;
      ratifiedOn: string;
      beforeFirstSlip: boolean;
      slips: readonly string[];
    }
  | { id: `credit:${string}`; written: string; slip: string; amount: string; slips: readonly string[] }
  | { id: "net"; terms: readonly EquationTerm[]; total: string; conserved: boolean; slips: readonly string[] }
  | {
      id: "fees";
      paypal: string;
      gcash: string;
      sources: readonly string[];
      rate: string;
      slips: readonly string[];
    };

export function equationTerms(dto: StatementDTO): EquationTerm[] {
  return receiptRows(dto)
    .filter((r) => r.kind !== "net")
    .map((r, i) => ({
      op: i === 0 ? null : r.cents < 0 ? "−" : "+",
      amount: format.usdPlain(Math.abs(r.cents)),
    }));
}

/** The trace for one receipt segment, or null when the line has no such segment. */
export function traceFor(dto: StatementDTO, id: TraceId, lang: Lang): Trace | null {
  const all = dto.slips.map((s) => s.serial);
  const share = shareFigures(dto);
  if (id === "premium") {
    return { id, kg: share.kg, coopKg: share.coopKg, rule: PREMIUM_RULE, slips: all };
  }
  if (id === "bonus") {
    return { id, grade1Kg: share.grade1Kg, allGrade1: share.allGrade1, slips: all };
  }
  if (id === "net") {
    return {
      id,
      terms: equationTerms(dto),
      total: format.usd(dto.amounts.netCents),
      conserved: lineConservation(dto).ok,
      slips: [],
    };
  }
  if (id === "fees") {
    const f = feeFigures();
    return {
      id,
      paypal: f.paypal,
      gcash: f.gcash,
      sources: [f.paypalSource, f.gcashSource],
      rate: rateLabel(dto),
      slips: [],
    };
  }
  if (id.startsWith("ded:")) {
    const d = dto.amounts.deductions.find((x) => `ded:${x.ruleId}` === id);
    if (!d) return null;
    return {
      id: `ded:${d.ruleId}`,
      label: d.label,
      rule: d.ruleId,
      card: dto.rateCard.id,
      ratifiedOn: format.date(dto.rateCard.ratifiedAt, lang),
      beforeFirstSlip: ratifiedBeforeFirstSlip(dto),
      slips: [],
    };
  }
  const c = dto.amounts.credits.find((x) => `credit:${x.slip}` === id);
  if (!c) return null;
  return {
    id: `credit:${c.slip}`,
    written: writtenPesos(c.writtenCentavos),
    slip: c.slip,
    amount: format.usd(c.cents),
    slips: dto.slips.some((s) => s.serial === c.slip) ? [c.slip] : [],
  };
}
