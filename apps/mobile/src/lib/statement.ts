/**
 * Member statement text (M-MB-01, M-MB-03). Claude's explainer (AI-8) writes words and `{{PLACEHOLDERS}}` only;
 * every number is filled in here from engine values formatted by `format.*`. Invariant I1 on the phone: a
 * sentence that carries a digit, or an unknown placeholder, is never shown or spoken.
 */
import type { StatementDTO } from "../_shims/api-client";
import type { Lang } from "../_shims/contracts";
import { format } from "../_shims/domain";

export interface PlaceholderValue {
  display: string;
  /** What device speech reads (money as words). Defaults to `display`. */
  spoken?: string;
  /** Slip mentions, so Paminawa can lift the chip the voice is naming. */
  mentions?: readonly string[];
}

export const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
/** Any Unicode decimal digit, so "٣" or "３" cannot slip a number past the check. */
const DIGIT_RE = /\p{Nd}/u;

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? "");
}

export function hasDigit(text: string): boolean {
  return DIGIT_RE.test(text.replace(PLACEHOLDER_RE, ""));
}

export type FilledSentence =
  | { ok: true; id: string; display: string; spoken: string; mentions: string[] }
  | { ok: false; id: string; reason: "digit-in-template" | "unknown-placeholder" | "stray-braces" };

export function fillSentence(
  s: { id: string; text: string },
  values: Readonly<Record<string, PlaceholderValue>>,
): FilledSentence {
  if (hasDigit(s.text)) return { ok: false, id: s.id, reason: "digit-in-template" };
  const names = placeholdersOf(s.text);
  if (names.some((n) => !(n in values))) return { ok: false, id: s.id, reason: "unknown-placeholder" };
  if (/\{\{|\}\}/.test(s.text.replace(PLACEHOLDER_RE, "")))
    return { ok: false, id: s.id, reason: "stray-braces" };
  const mentions: string[] = [];
  const display = s.text.replace(PLACEHOLDER_RE, (_, n: string) => {
    const v = values[n];
    for (const m of v?.mentions ?? []) mentions.push(m);
    return v?.display ?? "";
  });
  const spoken = s.text.replace(
    PLACEHOLDER_RE,
    (_, n: string) => values[n]?.spoken ?? values[n]?.display ?? "",
  );
  return { ok: true, id: s.id, display, spoken, mentions };
}

/** Engine values for the reference sentences s1–s7 (S1.10), in the member's language. */
export function statementValues(dto: StatementDTO, lang: Lang): Record<string, PlaceholderValue> {
  const a = dto.amounts;
  const cbu = a.deductions.find((d) => d.label === "CBU");
  const serials = dto.slips.map((s) => s.serial);
  const spokenSerial = (s: string) => s.split("").join(" ");
  const grade = dto.kilos.grade1Grams === dto.kilos.netGrams ? "Grade 1" : "Grade 1 ug Grade 2";
  return {
    NAME: { display: dto.member.nameByLang[lang] },
    NET_KG: {
      display: format.kg(dto.kilos.netGrams, 1),
      spoken: format.kg(dto.kilos.netGrams, 1).replace(" kg", " kilos"),
    },
    GRADE: { display: lang === "ceb" ? grade : grade.replace(" ug ", lang === "fil" ? " at " : " and ") },
    PAYER: { display: dto.payer.short },
    PREMIUM: { display: format.usd(a.premiumCents), spoken: format.amountSpoken(a.premiumCents) },
    BONUS: { display: format.usd(a.bonusCents), spoken: format.amountSpoken(a.bonusCents) },
    CBU: { display: format.usd(cbu?.cents ?? 0), spoken: format.amountSpoken(cbu?.cents ?? 0) },
    RULE: { display: cbu?.ruleId ?? "R1" },
    BR: { display: dto.rateCard.id },
    NET: { display: format.usd(a.netCents), spoken: format.amountSpoken(a.netCents) },
    NET_PHP: {
      display: format.peso(a.netCents, dto.fx.phpPerUsd),
      spoken: format.pesoSpoken(a.netCents, dto.fx.phpPerUsd),
    },
    SLIPS: {
      display: format.list(serials, lang),
      spoken: format.list(serials.map(spokenSerial), lang),
      mentions: serials.map((s) => `slip:${s}`),
    },
    TREASURER: { display: dto.treasurer.first },
  };
}

/** The member's sentences, filled; rejected ones are dropped and reported so the server can regenerate them. */
export function statementSentences(dto: StatementDTO, lang: Lang) {
  const values = statementValues(dto, lang);
  const filled = (dto.sentences[lang] ?? []).map((s) => fillSentence(s, values));
  return {
    sentences: filled.filter((f): f is Extract<FilledSentence, { ok: true }> => f.ok),
    rejected: filled.filter((f): f is Extract<FilledSentence, { ok: false }> => !f.ok),
  };
}
