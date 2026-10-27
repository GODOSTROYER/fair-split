import { spokenPhp, spokenUsd } from "./spoken.js";

export const LANGS = ["ceb", "fil", "en"] as const;
export type Lang = (typeof LANGS)[number];

export interface SpokenSentence {
  /** Statement slot (S4.5: GREETING … HELP; S1 reference copy rows s1–s7). */
  slot: string;
  text: string;
}

/**
 * M-014's statement for the S10 spike: S1's reference copy (s1 greeting, s5 pay) with the placeholders
 * filled from the register (Nang Celing, US$64.45, about ₱4,028) through the spoken templates. The real
 * statements come from AI-8 `explain()` and freeze on 1 Nov; all wording is pending native review (OD-2).
 */
export function m014SpikeStatement(lang: Lang): SpokenSentence[] {
  const name = "Nang Celing";
  const net = spokenUsd(6445);
  const php = spokenPhp(4028);
  switch (lang) {
    case "ceb":
      return [
        { slot: "s1", text: `Maayong adlaw, ${name}. Salamat sa inyong paghago.` },
        { slot: "s5", text: `Ang inyong bayad karong season: ${net}, mga ${php}, pinaagi sa PayPal.` },
      ];
    case "fil":
      return [
        { slot: "s1", text: `Magandang araw po, ${name}. Salamat po sa inyong pagsisikap.` },
        { slot: "s5", text: `Ang inyong bayad ngayong season: ${net}, humigit-kumulang ${php}, sa PayPal.` },
      ];
    case "en":
      return [
        { slot: "s1", text: `Good day, ${name}. Thank you for your hard work.` },
        { slot: "s5", text: `Your pay this season: ${net}, about ${php}, by PayPal.` },
      ];
  }
}

/** One English style note for every language (S4.6), passed as speech metadata, never spoken. */
export const STYLE_NOTE = "warm, unhurried, respectful; speaking to an older farmer";

/** Sentences joined by the inline `<long pause>` tag; the splitter cuts on those pauses (S4.6). */
export function joinForRequest(sentences: readonly SpokenSentence[]): string {
  return sentences.map((s) => s.text).join(" <long pause> ");
}
