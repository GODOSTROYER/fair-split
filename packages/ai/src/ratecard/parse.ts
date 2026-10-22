import type { Basis } from "./schema.js";

/**
 * Re-parsing (S4.3): code, not the model, turns `value_as_written` and `cap_as_written` into typed
 * integers — basis points, centavos, cents, or tenths of a kilo per tree. A string that does not
 * parse is a "Check" on the term, never a guess.
 */
export type TypedValue =
  | { unit: "none" }
  | { unit: "bp"; value: number }
  | { unit: "centavos"; value: number }
  | { unit: "cents"; value: number }
  | { unit: "centavos_per_kg"; value: number }
  | { unit: "tenths_kg_per_tree"; value: number };

export type ParseResult = { ok: true; value: TypedValue } | { ok: false; reason: string };

const NONE: ParseResult = { ok: true, value: { unit: "none" } };

/** "1,234.5" → 123450 hundredths, exactly. */
function hundredths(s: string): number | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m?.[1]) return null;
  return Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** A percentage → basis points: "5%" → 500, "±2.0%" → 200, "50 %" → 5000. */
export function parsePercent(s: string): number | null {
  const all = [...s.matchAll(/(?:±|\+\/-)?\s*(\d+(?:\.\d{1,2})?)\s*(?:%|percent\b|porsiyento\b)/gi)];
  if (all.length !== 1) return null;
  return hundredths(all[0]?.[1] ?? "");
}

/** A peso amount → centavos: "₱1.50" → 150, "P5,000" → 500000, "PHP 200" → 20000. */
export function parsePeso(s: string): number | null {
  const all = [
    ...s.matchAll(/(?:₱|\bPHP\s?|\bP(?=\s?\d))\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g),
  ];
  if (all.length !== 1) return null;
  return hundredths(all[0]?.[1] ?? "");
}

/** A dollar amount → cents: "US$300" → 30000, "USD 150.00" → 15000. */
export function parseUsd(s: string): number | null {
  const all = [...s.matchAll(/(?:US\$|\bUSD\s?|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)];
  if (all.length !== 1) return null;
  return hundredths(all[0]?.[1] ?? "");
}

/** "1.6 kg per registered tree" → 16 tenths of a kilo per tree. */
export function parseKgPerTree(s: string): number | null {
  const all = [...s.matchAll(/(\d+(?:\.\d)?)\s*(?:kg|kilos?|kilograms?)\b/gi)];
  if (all.length !== 1) return null;
  const h = hundredths(all[0]?.[1] ?? "");
  return h === null ? null : h / 10;
}

/** A confidence threshold → basis points: "0.85" → 8500, "85%" → 8500. */
export function parseConfidence(s: string): number | null {
  const pct = parsePercent(s);
  if (pct !== null) return pct;
  const all = [...s.matchAll(/(?<![\d.])(0?\.\d{1,4}|1(?:\.0{1,4})?)(?![\d.])/g)];
  if (all.length !== 1) return null;
  const v = all[0]?.[1] ?? "";
  const [i, f = ""] = v.split(".");
  return Number(i || "0") * 10000 + Number(f.padEnd(4, "0"));
}

const fail = (reason: string): ParseResult => ({ ok: false, reason });
const ok = (value: TypedValue): ParseResult => ({ ok: true, value });

/** Parses `value_as_written` for a term's basis. */
export function parseValue(basis: Basis, written: string): ParseResult {
  const s = written.trim();
  switch (basis) {
    case "VERIFIED_KG":
    case "VERIFIED_G1_KG":
    case "OVERRIDE":
    case "NONE":
      return NONE;
    case "PCT_OF_BONUS": {
      if (!s) return NONE; // R3/R4 carry only a cap
      const bp = parsePercent(s);
      return bp === null ? fail(`no single percentage in "${s}"`) : ok({ unit: "bp", value: bp });
    }
    case "PER_NET_KG": {
      const c = parsePeso(s);
      return c === null ? fail(`no single peso rate in "${s}"`) : ok({ unit: "centavos_per_kg", value: c });
    }
    case "BATCH_TOTAL":
    case "LINE_TOTAL": {
      const c = parseUsd(s);
      return c === null ? fail(`no single US$ amount in "${s}"`) : ok({ unit: "cents", value: c });
    }
    case "MASS_BALANCE": {
      const bp = parsePercent(s);
      return bp === null ? fail(`no single tolerance in "${s}"`) : ok({ unit: "bp", value: bp });
    }
    case "KG_PER_TREE": {
      const t = parseKgPerTree(s);
      return t === null
        ? fail(`no single kg-per-tree limit in "${s}"`)
        : ok({ unit: "tenths_kg_per_tree", value: t });
    }
    case "READ_CONFIDENCE": {
      const bp = parseConfidence(s);
      return bp === null ? fail(`no single confidence in "${s}"`) : ok({ unit: "bp", value: bp });
    }
  }
}

/** Parses `cap_as_written`: a percentage (bp), a peso amount (centavos) or a dollar amount (cents). */
export function parseCap(written: string): ParseResult {
  const s = written.trim();
  if (!s) return NONE;
  const kinds: ParseResult[] = [];
  const bp = parsePercent(s);
  if (bp !== null) kinds.push(ok({ unit: "bp", value: bp }));
  const php = parsePeso(s);
  if (php !== null) kinds.push(ok({ unit: "centavos", value: php }));
  const usd = parseUsd(s);
  if (usd !== null) kinds.push(ok({ unit: "cents", value: usd }));
  if (kinds.length !== 1) return fail(`cap "${s}" is not exactly one percentage or amount`);
  return kinds[0] as ParseResult;
}

/** Bases whose value must be present (a term without one is a "Check"). */
export const VALUE_REQUIRED: ReadonlySet<Basis> = new Set<Basis>([
  "PER_NET_KG",
  "BATCH_TOTAL",
  "LINE_TOTAL",
  "MASS_BALANCE",
  "KG_PER_TREE",
  "READ_CONFIDENCE",
]);
