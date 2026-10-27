import type { TypedValue } from "../ratecard/parse.js";
import type { Basis, RequiredDocument } from "../ratecard/schema.js";

/**
 * The amount check behind AI-6 (S4.2 "Deduction classifier"). Code parses the written amount and
 * checks it against the ratified rule; the model only names the rule.
 */

/**
 * The written amount: the last number on the line, optionally prefixed ₱, P or PHP → centavos. A
 * number is a maximal run of digits with "," or "." only between digits, read strictly ("1,300.00",
 * "91.20"); a run that is no well-formed amount ("91.205", "1.091.20", "1,30") makes no amount at all,
 * never its tail, so the rule's check fails closed (as ratecard/parse.ts reads a rate card).
 */
export function parseWrittenAmount(line: string): number | null {
  const last = [...line.matchAll(/\d+(?:[.,]\d+)*/g)].at(-1)?.[0];
  const m = last ? /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(last) : null;
  if (!m?.[1]) return null;
  const minor = Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** A voucher number written on the line, e.g. "CA-0192". */
export function voucherOn(line: string): string | null {
  return /\b([A-Z]{1,3}-\d{3,5})\b/.exec(line.toUpperCase())?.[1] ?? null;
}

/** The ratified deduction rule a mark is checked against (typed values from the ratified card). */
export interface DeductionRule {
  rule_id: string;
  basis: Basis;
  value: TypedValue | null;
  cap: TypedValue | null;
  requires_document: RequiredDocument;
}

export interface AmountContext {
  /** The slip's agreed net weight in grams (R2 is per kilo of net weight). */
  netGrams?: number | null;
  /** Documents on file for the member (R3 needs an Authority to Deduct, R4 a numbered voucher). */
  authorityToDeduct?: boolean;
  vouchers?: readonly string[];
}

export type AmountCheck =
  | { ok: true; expectedMinor?: number }
  | { ok: false; reason: string; expectedMinor?: number };

/** Round half up, per component (register §2 arithmetic). */
const roundHalfUp = (num: number, den: number): number => Math.floor((2 * num + den) / (2 * den));

export function checkAmount(
  rule: DeductionRule,
  line: string,
  writtenMinor: number | null,
  ctx: AmountContext,
): AmountCheck {
  switch (rule.basis) {
    case "PER_NET_KG": {
      if (rule.value?.unit !== "centavos_per_kg") return { ok: false, reason: "rule has no per-kilo rate" };
      if (writtenMinor === null) return { ok: false, reason: "no written amount" };
      if (ctx.netGrams === null || ctx.netGrams === undefined)
        return { ok: false, reason: "net weight not agreed" };
      const expected = roundHalfUp(rule.value.value * ctx.netGrams, 1000);
      return writtenMinor === expected
        ? { ok: true, expectedMinor: expected }
        : {
            ok: false,
            reason: `written ${writtenMinor} centavos, rule gives ${expected}`,
            expectedMinor: expected,
          };
    }
    case "PCT_OF_BONUS": {
      // A share of the quality bonus is computed at pay time; caps are checked by the engine then.
      if (rule.requires_document === "AUTHORITY_TO_DEDUCT") {
        return ctx.authorityToDeduct
          ? { ok: true }
          : { ok: false, reason: "no signed Authority to Deduct on file" };
      }
      if (rule.requires_document === "VOUCHER") {
        const v = voucherOn(line);
        if (!v) return { ok: false, reason: "no voucher number on the line" };
        return ctx.vouchers?.includes(v)
          ? { ok: true }
          : { ok: false, reason: `voucher ${v} is not on file` };
      }
      return {
        ok: false,
        reason: `${rule.rule_id} is taken at pay time; a mark written on the slip is not the rule`,
      };
    }
    default:
      return { ok: false, reason: `${rule.rule_id} (${rule.basis}) is not a deduction a slip can carry` };
  }
}
