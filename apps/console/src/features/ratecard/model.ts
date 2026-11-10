// The rate card's read model (W-TR-02), pure. Schedule A printed flat from the ratified card (BR 2026-04), each
// rule tied to the clause it was read from on the scanned pages, and the refusal plate's words built from a
// 409 RATE_CARD_RATIFIED (MM-4). Every number comes from the card's typed rules (I2: rules before facts); the
// hash is the 409's, the one the board sealed.

import type { RateTerm, RuleId, SeasonSnapshot } from "@fairsplit/contracts";
import { format } from "../../lib/format.js";
import { RATECARD_COPY } from "./copy.js";

type Card = SeasonSnapshot["rateCard"];
type TextLayer = Card["textLayer"];

export type ScheduleRuleId = "R0" | "R1" | "R2" | "R3" | "R4" | "holds" | "cosign" | "closed";

export interface ScheduleRule {
  readonly id: ScheduleRuleId;
  /** The card's rule ID ("R6" for the hold rules, "CLOSED" for the closed list). */
  readonly ruleId: RuleId;
  /** What the rule reads as, printed flat. */
  readonly text: string;
  /** The verbatim quote it was read from (must be in the text layer). */
  readonly quote: string;
  readonly page: number;
}

/** "1.6 kg", "±2.0%", "0.85", "US$300": the tolerance and co-sign values as the card states them. */
export function holdsText(card: Card): string {
  const t = card.canonical.rules.tolerances;
  const perTree = format.kg(t.kgPerTreeMaxG);
  const balance = `±${format.percentBp(t.massBalanceTolBp, 1)}`;
  const confidence = (t.autoAcceptBp / 10_000).toFixed(2);
  return `Holds: more than ${perTree} a registered tree, mass balance outside ${balance}, or a reading below ${confidence} confidence goes to a person.`;
}

/** A percentage from basis points with no trailing zeros: 500 → "5", 250 → "2.5". */
function sharePct(bp: number): string {
  return format
    .percentBp(bp, 2)
    .replace(/%$/, "")
    .replace(/\.?0+$/, "");
}

/** Pesos as the card states them: whole pesos when the term is whole ("₱5,000"), else to the centavo ("₱1.50"). */
function pesos(centavos: number): string {
  return centavos % 100 === 0 ? format.pesoWhole(centavos) : format.money(centavos, "PHP");
}

/**
 * The ratified card's own terms for R1 to R4's copy (i18n `W-TR-02.R1`…`R4` take them as arguments): the copy
 * never restates a figure the card could change, so the plate prints exactly what BR 2026-04 bolted.
 */
export function ruleTerms(card: Card) {
  const r = card.canonical.rules;
  return {
    R1: { share: sharePct(r.cbu.bp), cap: pesos(r.cbu.paidUpCapCentavos) },
    R2: { rate: pesos(r.hauling.centavosPerNetKg) },
    R3: { share: sharePct(r.loan.capBp) },
    R4: { share: sharePct(r.advance.capBp) },
  } as const;
}

export function cosignText(card: Card): string {
  const c = card.canonical.rules.cosign;
  const override = c.anyOverride ? ", or any override of a hold" : "";
  return `Co-sign: the Chair co-signs a batch over ${format.money(c.batchOverCents)}, a line over ${format.money(c.lineOverCents)}${override}.`;
}

function termFor(card: Card, ruleId: RuleId, labelHint?: RegExp): RateTerm | undefined {
  const terms = card.canonical.terms.filter((t) => t.ruleId === ruleId);
  return (labelHint ? terms.find((t) => labelHint.test(t.label)) : undefined) ?? terms[0];
}

/** Schedule A as printed on W-TR-02: R0 to R4 in the card's words, co-sign (R5), the holds (R6), the closed list. */
export function scheduleRules(
  card: Card,
  printed: Readonly<Record<"R0" | "R1" | "R2" | "R3" | "R4", string>>,
) {
  const rules: ScheduleRule[] = [];
  const add = (id: ScheduleRuleId, ruleId: RuleId, text: string, term: RateTerm | undefined) => {
    if (term) rules.push({ id, ruleId, text, quote: term.source.quote, page: term.source.page });
  };
  add("R0", "R0", printed.R0, termFor(card, "R0", /premium/i));
  add("R1", "R1", printed.R1, termFor(card, "R1"));
  add("R2", "R2", printed.R2, termFor(card, "R2"));
  add("R3", "R3", printed.R3, termFor(card, "R3"));
  add("R4", "R4", printed.R4, termFor(card, "R4"));
  add("cosign", "R5", cosignText(card), termFor(card, "R5"));
  add("holds", "R6", holdsText(card), termFor(card, "R6"));
  add(
    "closed",
    "CLOSED",
    `Closed list: no other deduction applies to any payout, and the schedule doesn't change during Season ${seasonLabel(card)}.`,
    termFor(card, "CLOSED"),
  );
  return rules;
}

function seasonLabel(card: Card): string {
  const code = card.canonical.season;
  return /^\d{4}[A-Z]$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The season after this one ("2026-A" → "2026-B"): where a new deduction could start. */
export function nextSeason(label: string): string {
  const m = /^(\d{4})-([A-Z])$/.exec(label);
  if (!m) return label;
  const [, year = "", letter = "A"] = m;
  return letter === "Z"
    ? `${Number(year) + 1}-A`
    : `${year}-${String.fromCharCode(letter.charCodeAt(0) + 1)}`;
}

function normal(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface ClauseRef {
  readonly page: number;
  readonly line: number;
}

/**
 * Where a rule's quote sits on the scanned pages: every line of its page that shares a sentence with it. The
 * quote must be in the text layer (S4: quotes must match the verified text layer); a miss returns nothing.
 */
export function clauseLines(layer: TextLayer, quote: string, page: number): ClauseRef[] {
  const target = normal(quote);
  const sheet = layer.pages.find((p) => p.page === page);
  if (!sheet) return [];
  const out: ClauseRef[] = [];
  sheet.lines.forEach((text, i) => {
    const line = normal(text).replace(/^r\d\s+/, "");
    if (line.length > 0 && (target.includes(line) || line.includes(target.slice(0, 48))))
      out.push({ page, line: i });
  });
  return out;
}

export interface Refusal {
  readonly hash: string;
  readonly rateCard: string;
  readonly ratifiedOn: string;
}

/**
 * The refusal plate (S1.7 W-TR-02; UI gate round 3), every part from the 409 and the card: the title the plate
 * leads with, its "Why" (one line, never the rule list the schedule beside it already prints), and apart the hash
 * it cites.
 */
export function refusalParts(
  card: Card,
  refusal: Refusal,
): { readonly title: string; readonly body: string; readonly hash: string } {
  const season = seasonLabel(card);
  const next = nextSeason(season);
  return {
    title: RATECARD_COPY.refused(next),
    body: RATECARD_COPY.refusalBody(refusal.rateCard, season, next),
    hash: RATECARD_COPY.refusalHash(format.hashGroups(refusal.hash)),
  };
}

/** The bolted plate's line: "sha256 f2d7 026d, sealed 14 Mar 2026 by BR 2026-04". */
export function sealedText(card: Card): string {
  return `sha256 ${format.hashGroups(card.sha256)}, sealed ${format.date(card.canonical.ratifiedOn)} by ${card.canonical.resolutionNo}`;
}
