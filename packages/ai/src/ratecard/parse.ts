import type { Basis } from "./schema.js";

/**
 * Re-parsing (S4.3): code, not the model, turns `value_as_written` and `cap_as_written` into typed
 * integers — basis points, centavos, cents, or tenths of a kilo per tree. A string that does not
 * parse is a "Check" on the term, never a guess. A typed value is one whole number as written:
 * - a number is a maximal run of digits with "," or "." only between digits, so "12.505%", "₱1,5000"
 *   and "1.65 kg" never yield a shorter number ("505%", "₱1,500", "65 kg"); a run that does not read
 *   strictly for its unit ("1,000%", "1,6 kg", a third decimal) fails, and so does one touching more
 *   digits ("₱1 500", "₱5M", ".85%");
 * - a minus sign or dash before the value (its marker skipped) fails: "-5%", "−₱200", "(-P 1.50)",
 *   the "10%" of "5–10%". A dash spaced between words ("CBU - 5% of the bonus") is punctuation;
 * - exactly one value of the unit: "5% or 6%" fails, and so does a malformed second one.
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

/** Hyphen-minus, the Unicode hyphens and dashes, the minus sign, small and full-width hyphen-minus. */
const DASH = "[-\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]";
const DASH_AT_END = new RegExp(`${DASH}$`, "u");
/** A letter, digit or underscore: what `\b` treats as part of a word. */
const WORDISH = /[\p{L}\p{N}_]/u;

/** Peso and dollar marks right before the digits (at most one space), and a sign written after one. */
const PESO_MARK = new RegExp(`(?:₱|(?<![\\p{L}\\p{N}_])PHP|(?<![\\p{L}\\p{N}_])P)\\s?(${DASH}\\s?)?$`, "u");
const USD_MARK = new RegExp(`(?:US\\$|(?<![\\p{L}\\p{N}_])USD|\\$)\\s?(${DASH}\\s?)?$`, "u");
/** "±2.0%", "+/-2%": a tolerance's sign, part of how it is written. */
const PLUS_MINUS = /(?:±|\+\/-)\s*$/;
const PERCENT_UNIT = /^\s*(?:%|percent\b|porsiyento\b)/i;
const KG_UNIT = /^\s*(?:kg|kilos?|kilograms?)\b/i;

const MONEY = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
const PLAIN = /^(\d+)(?:\.(\d{1,2}))?$/;
const FRACTION = /^(?:0?\.\d{1,4}|1(?:\.0{1,4})?)$/;

/** A maximal numeric run of the text. */
interface Run {
  text: string;
  start: number;
  end: number;
}

/**
 * Every maximal numeric run: digits, with "," or "." only between digits ("12.505", "1,5000" and
 * "3,261,467" are each one run). With `leadingDot`, a "." right before the digits belongs to the run
 * (".85").
 */
function numberRuns(s: string, leadingDot = false): Run[] {
  return [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => {
    const end = m.index + m[0].length;
    const start = leadingDot && s[m.index - 1] === "." ? m.index - 1 : m.index;
    return { text: s.slice(start, end), start, end };
  });
}

/** "1,234.5" → 123450 hundredths, exactly, by `pattern`; null when malformed or not a safe integer. */
function hundredths(run: string, pattern: RegExp): number | null {
  const m = pattern.exec(run);
  if (!m?.[1]) return null;
  const v = Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(v) ? v : null;
}

/**
 * The run touches other digits, so it is part of a longer number as written: right after a "." or ","
 * (".85%", "1..5"), or one space from a three-digit group ("₱1 500", "1 500%").
 */
function partOfLonger(s: string, run: Run): boolean {
  if (/[\d.,]/.test(s[run.start - 1] ?? "")) return true;
  if (/^\s\d{3}(?!\d)/.test(s.slice(run.end))) return true;
  return /^\d{3}(?![\d.,]\d)/.test(run.text) && /(?<![\d.,])\d{1,3}\s$/.test(s.slice(0, run.start));
}

/**
 * A minus sign or dash before the value, its marker skipped (`markStart`): the value is negative.
 * A dash with spaces on both sides after a word ("CBU - 5%") is punctuation; one after a number is a
 * range ("5 - 10%"), and one at the start or after a bracket is a sign.
 */
function signedBefore(s: string, markStart: number): boolean {
  const pre = s.slice(0, markStart);
  const t = pre.trimEnd();
  if (!DASH_AT_END.test(t)) return false;
  const spaced = t.length < pre.length && /\p{L}\s+$/u.test(t.slice(0, -1));
  return !spaced;
}

/**
 * The one value of a unit in `s`, or null. `candidate` says whether a run is a value of the unit and,
 * if so, where its marker starts and what the run reads as (null: malformed, so the parse fails).
 */
function single(
  s: string,
  runs: readonly Run[],
  candidate: (run: Run) => { markStart: number; value: number | null; signed?: boolean } | null,
): number | null {
  const found = runs.flatMap((run) => {
    const c = candidate(run);
    return c ? [{ run, ...c }] : [];
  });
  if (found.length !== 1) return null;
  const [c] = found as [(typeof found)[number]];
  if (c.value === null || c.signed || partOfLonger(s, c.run) || signedBefore(s, c.markStart)) return null;
  return c.value;
}

/** A run with a percent unit after it: its basis points, its marker the ± before it if any. */
function percentCandidate(s: string, run: Run) {
  if (!PERCENT_UNIT.test(s.slice(run.end))) return null;
  const before = s.slice(0, run.start);
  const pm = PLUS_MINUS.exec(before);
  const attached = !pm && WORDISH.test(before.at(-1) ?? ""); // "R25%": glued to a word
  return { markStart: pm ? pm.index : run.start, value: attached ? null : hundredths(run.text, PLAIN) };
}

function moneyCandidate(s: string, run: Run, mark: RegExp) {
  const m = mark.exec(s.slice(0, run.start));
  if (!m) return null;
  // "₱5M", "₱5k": a letter right after the digits changes the amount.
  const glued = /^\p{L}/u.test(s.slice(run.end));
  return {
    markStart: m.index,
    value: glued ? null : hundredths(run.text, MONEY),
    signed: m[1] !== undefined,
  };
}

/** A percentage → basis points: "5%" → 500, "±2.0%" → 200, "50 %" → 5000. */
export function parsePercent(s: string): number | null {
  return single(s, numberRuns(s), (run) => percentCandidate(s, run));
}

/** A peso amount → centavos: "₱1.50" → 150, "P5,000" → 500000, "PHP 200" → 20000. */
export function parsePeso(s: string): number | null {
  return single(s, numberRuns(s), (run) => moneyCandidate(s, run, PESO_MARK));
}

/** A dollar amount → cents: "US$300" → 30000, "USD 150.00" → 15000. */
export function parseUsd(s: string): number | null {
  return single(s, numberRuns(s), (run) => moneyCandidate(s, run, USD_MARK));
}

/** "1.6 kg per registered tree" → 16 tenths of a kilo per tree ("1.60 kg" too; "1.65 kg" fails). */
export function parseKgPerTree(s: string): number | null {
  return single(s, numberRuns(s), (run) => {
    if (!KG_UNIT.test(s.slice(run.end))) return null;
    const h = WORDISH.test(s[run.start - 1] ?? "") ? null : hundredths(run.text, PLAIN);
    return { markStart: run.start, value: h !== null && h % 10 === 0 ? h / 10 : null };
  });
}

/**
 * A confidence threshold → basis points: "0.85" → 8500, ".85" → 8500, "1" → 10000, "85%" → 8500.
 * Every number counts (except digits inside a word, "R6"): "0.85 (85%)" is two and fails. A fraction
 * is unsigned and stands alone: "±0.85", "+0.85" and "0.85x" fail.
 */
export function parseConfidence(s: string): number | null {
  return single(s, numberRuns(s, true), (run) => {
    const pct = percentCandidate(s, run);
    if (pct) return pct;
    const before = s.slice(0, run.start);
    if (WORDISH.test(before.at(-1) ?? "")) return null;
    const alone = FRACTION.test(run.text) && !/[±+]\s*$/.test(before) && !WORDISH.test(s[run.end] ?? "");
    if (!alone) return { markStart: run.start, value: null };
    const [i, f = ""] = run.text.split(".");
    return { markStart: run.start, value: Number(i || "0") * 10000 + Number(f.padEnd(4, "0")) };
  });
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
