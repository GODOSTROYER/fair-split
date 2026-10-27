// I2: rules are frozen before facts. The ratified card is JCS-canonicalized and sha256-hashed;
// rc8 (first 8 hex) goes into sender_batch_id and sha16 into the invoice reference.
import type { RateCardCanonical, Ratification, RatifiedRateCard, RuleId } from "@fairsplit/contracts";
import { jcsSha256 } from "./canon.js";

export interface RateCardHash {
  sha256: string;
  rc8: string;
  sha16: string;
}

export function hashRateCard(canonical: RateCardCanonical): RateCardHash {
  const sha256 = jcsSha256(canonical);
  return { sha256, rc8: sha256.slice(0, 8), sha16: sha256.slice(0, 16) };
}

export function ratifyRateCard(
  canonical: RateCardCanonical,
  ratifiedAt: string,
  ratifications: Ratification[],
): RatifiedRateCard {
  return { canonical, ...hashRateCard(canonical), ratifiedAt, ratifications };
}

/** True when the stored hash still matches the canonical content (Proof plate 2). */
export function rateCardIntact(card: Pick<RatifiedRateCard, "canonical" | "sha256">): boolean {
  return hashRateCard(card.canonical).sha256 === card.sha256;
}

/**
 * I2 guard: every slip must be dated on or after the ratification day. Returns the offending
 * slip dates (empty when the rules came first). Mirrors the DB trigger FS422 RULES_BEFORE_FACTS.
 */
export function factsBeforeRules(ratifiedAt: string, slipDates: readonly string[]): string[] {
  const day = ratifiedAt.slice(0, 10);
  return slipDates.filter((d) => d < day);
}

/** The card's closed list: deduction rule IDs a slip mark may cite. */
export function deductionRuleIds(card: RatifiedRateCard): RuleId[] {
  return [...card.canonical.rules.closedList.deductionRuleIds];
}

/** Every term's quote must appear verbatim in the text layer (whitespace and quote marks normalised). */
export function quotesInTextLayer(card: RateCardCanonical, textLayer: string): string[] {
  const norm = (s: string) =>
    s
      .replace(/[‘’“”'"]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const hay = norm(textLayer);
  return card.terms.filter((t) => !hay.includes(norm(t.source.quote))).map((t) => `${t.ruleId}/${t.pool}`);
}
