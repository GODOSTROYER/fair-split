import { overlaps } from "../read/geometry.js";
import { parseCap, parseValue, type TypedValue, VALUE_REQUIRED } from "./parse.js";
import type { RateCardRead, Term, TextLayer } from "./schema.js";

/**
 * Checks on each term (S4.3). A failure shows "Check" against the term in the C2 draft; the board
 * edits and ratifies. A HANDWRITTEN_AMENDMENT never becomes a term.
 */
export type CheckCode =
  | "QUOTE_NOT_IN_TEXT_LAYER"
  | "VALUE_NOT_IN_QUOTE"
  | "CAP_NOT_IN_QUOTE"
  | "VALUE_UNPARSED"
  | "CAP_UNPARSED"
  | "VALUE_MISSING"
  | "DUPLICATE_TERM"
  | "FROM_AMENDMENT";

export interface TermCheck {
  code: CheckCode;
  detail: string;
}

export interface DraftTerm {
  rule_id: string;
  kind: Term["kind"];
  pool: Term["pool"];
  basis: Term["basis"];
  value: TypedValue | null;
  cap: TypedValue | null;
  value_as_written: string;
  cap_as_written: string;
  condition_as_written: string;
  requires_document: Term["requires_document"];
  source: Term["source"];
  checks: TermCheck[];
  ok: boolean;
}

export interface RateCardDraft {
  resolution_no: string;
  ratified_on_as_written: string;
  terms: DraftTerm[];
  /** Handwritten amendments shown to the board; never terms. */
  amendments: RateCardRead["anomalies"];
  /** Instruction-like text found on the pages: quarantined, never a term. */
  quarantined: RateCardRead["anomalies"];
  signatories: RateCardRead["signatories"];
  ok: boolean;
}

/** Only whitespace and quote marks are normalised (S4.3). */
export function normaliseQuote(s: string): string {
  return s
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The uniqueness key: (rule_id, pool, basis). See the report: (rule_id, pool) alone would reject R5/R6. */
export const termKey = (t: Pick<Term, "rule_id" | "pool" | "basis">): string =>
  `${t.rule_id}|${t.pool}|${t.basis}`;

export function checkRateCard(read: RateCardRead, textLayer: TextLayer): RateCardDraft {
  const pageText = new Map(textLayer.pages.map((p) => [p.page, normaliseQuote(p.text)]));
  const amendments = read.anomalies.filter((a) => a.kind === "HANDWRITTEN_AMENDMENT");
  const counts = new Map<string, number>();
  for (const t of read.terms) counts.set(termKey(t), (counts.get(termKey(t)) ?? 0) + 1);

  const terms = read.terms.map((t): DraftTerm => {
    const checks: TermCheck[] = [];
    const quote = normaliseQuote(t.source.quote);
    const page = pageText.get(t.source.page);
    if (!quote || !page?.includes(quote)) {
      checks.push({ code: "QUOTE_NOT_IN_TEXT_LAYER", detail: `page ${t.source.page}` });
    }
    const value = normaliseQuote(t.value_as_written);
    if (value && !quote.includes(value))
      checks.push({ code: "VALUE_NOT_IN_QUOTE", detail: t.value_as_written });
    const cap = normaliseQuote(t.cap_as_written);
    if (cap && !quote.includes(cap)) checks.push({ code: "CAP_NOT_IN_QUOTE", detail: t.cap_as_written });
    if (!value && VALUE_REQUIRED.has(t.basis)) checks.push({ code: "VALUE_MISSING", detail: t.basis });
    const pv = parseValue(t.basis, t.value_as_written);
    if (!pv.ok) checks.push({ code: "VALUE_UNPARSED", detail: pv.reason });
    const pc = parseCap(t.cap_as_written);
    if (!pc.ok) checks.push({ code: "CAP_UNPARSED", detail: pc.reason });
    if ((counts.get(termKey(t)) ?? 0) > 1) checks.push({ code: "DUPLICATE_TERM", detail: termKey(t) });
    const fromAmendment = amendments.some(
      (a) =>
        (a.page === t.source.page && overlaps(a.box, t.source.box)) ||
        (normaliseQuote(a.verbatim) !== "" && quote.includes(normaliseQuote(a.verbatim))),
    );
    if (fromAmendment)
      checks.push({ code: "FROM_AMENDMENT", detail: "handwritten amendments never become terms" });
    return {
      rule_id: t.rule_id,
      kind: t.kind,
      pool: t.pool,
      basis: t.basis,
      value: pv.ok ? pv.value : null,
      cap: pc.ok ? pc.value : null,
      value_as_written: t.value_as_written,
      cap_as_written: t.cap_as_written,
      condition_as_written: t.condition_as_written,
      requires_document: t.requires_document,
      source: t.source,
      checks,
      ok: checks.length === 0,
    };
  });
  return {
    resolution_no: read.resolution_no,
    ratified_on_as_written: read.ratified_on_as_written,
    terms,
    amendments,
    quarantined: read.anomalies.filter((a) => a.kind === "INSTRUCTION_LIKE_TEXT"),
    signatories: read.signatories,
    ok: terms.length > 0 && terms.every((t) => t.ok),
  };
}
