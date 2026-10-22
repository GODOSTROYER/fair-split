/**
 * Member statement text (M-MB-01, M-MB-03). Templates (S1.11, written or drafted offline and committed by a person)
 * hold words and `{{PLACEHOLDERS}}` only; every number is filled in here from engine values formatted by
 * `format.*`. Invariant I1 on the phone: a sentence that carries a digit, or an unknown placeholder, is never shown
 * or spoken.
 */
import type { StatementDTO } from "../_shims/api-client";
import type { Lang, StatementSlot, StatementTemplate } from "../_shims/contracts";
import { FEE_TABLE, format } from "../_shims/domain";
import type { Segment } from "../ui/figures";

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
  | {
      ok: true;
      id: string;
      slot: StatementSlot | null;
      display: string;
      spoken: string;
      mentions: string[];
      /** Template words and engine values in order, so figures can be set in the figure face (design §2.3). */
      segments: Segment[];
    }
  | { ok: false; id: string; reason: "digit-in-template" | "unknown-placeholder" | "stray-braces" };

export function fillSentence(
  s: { id: string; text: string; slot?: StatementSlot },
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
  const segments: Segment[] = [];
  let last = 0;
  for (const m of s.text.matchAll(PLACEHOLDER_RE)) {
    const at = m.index ?? 0;
    if (at > last) segments.push({ text: s.text.slice(last, at), value: false });
    segments.push({ text: values[m[1] ?? ""]?.display ?? "", value: true });
    last = at + m[0].length;
  }
  if (last < s.text.length) segments.push({ text: s.text.slice(last), value: false });
  return { ok: true, id: s.id, slot: s.slot ?? null, display, spoken, mentions, segments };
}

const GRADE_ALL: Readonly<Record<Lang, string>> = {
  ceb: "tanan Grade 1",
  fil: "lahat ay Grade 1",
  en: "all Grade 1",
};
const GRADE_PART: Readonly<Record<Lang, (kg: string) => string>> = {
  ceb: (kg) => `${kg} niini Grade 1`,
  fil: (kg) => `${kg} dito ay Grade 1`,
  en: (kg) => `${kg} of it Grade 1`,
};

const usd = (cents: number): PlaceholderValue => ({
  display: format.usd(cents),
  spoken: format.amountSpoken(cents),
});
const kilos = (grams: number): PlaceholderValue => ({
  display: format.kg(grams, 1),
  spoken: format.kg(grams, 1).replace(" kg", " kilos"),
});

/** Which PAY sentence applies: a line that moved to the bodega reads the cash variant. */
export type PayRail = "paypal" | "cash";

/**
 * Engine values for one template, in the member's language. Values that depend on the sentence (which deduction,
 * which credit) come from its `ref`.
 */
export function statementValues(
  dto: StatementDTO,
  lang: Lang,
  s?: Pick<StatementTemplate, "slot" | "ref">,
  rail: PayRail = dto.rail === "CASH" ? "cash" : "paypal",
): Record<string, PlaceholderValue> {
  const a = dto.amounts;
  const serials = dto.slips.map((x) => x.serial);
  const spokenSerial = (x: string) => x.split("").join(" ");
  const g1 = dto.kilos.grade1Grams;
  const deduction = s?.slot === "DEDUCTION" ? a.deductions.find((d) => d.ruleId === s.ref) : a.deductions[0];
  const credit = s?.slot === "CREDIT" ? a.credits.find((c) => c.slip === s.ref) : a.credits[0];
  const rate = dto.fx.phpPerUsd;
  const values: Record<string, PlaceholderValue> = {
    HONORIFIC_NAME: { display: dto.member.nameByLang[lang] },
    KG_TOTAL: kilos(dto.kilos.netGrams),
    GRADE_SUMMARY: {
      display: g1 === dto.kilos.netGrams ? GRADE_ALL[lang] : GRADE_PART[lang](format.kg(g1)),
    },
    PAYER: { display: dto.payer.short },
    PREMIUM_USD: usd(a.premiumCents),
    BONUS_USD: usd(a.bonusCents),
    BR: { display: dto.rateCard.id },
    NET_USD: usd(a.netCents),
    NET_PHP:
      rail === "cash"
        ? { display: format.cashPesos(a.netCents, rate), spoken: format.cashSpoken(a.netCents, rate) }
        : { display: format.peso(a.netCents, rate), spoken: format.pesoSpoken(a.netCents, rate) },
    FX_FEE: { display: format.percentBp(FEE_TABLE.paypalConversionBp) },
    RATE: { display: `₱${rate}` },
    SLIPS: {
      display: format.list(serials, lang),
      spoken: format.list(serials.map(spokenSerial), lang),
      mentions: serials.map((x) => `slip:${x}`),
    },
    TREASURER: { display: dto.treasurer.first },
  };
  if (dto.cashDay) values.CASH_DATE = { display: format.date(dto.cashDay, lang) };
  if (deduction) {
    values.DEDUCTION_USD = usd(deduction.cents);
    values.RULE_LABEL = { display: deduction.label };
    values.RULE = { display: deduction.ruleId };
  }
  if (credit) {
    values.CREDIT_USD = usd(credit.cents);
    values.WRITTEN_PHP = { display: `₱${format.usdPlain(credit.writtenCentavos).replace(/\.00$/, "")}` };
    values.SLIP = {
      display: credit.slip,
      spoken: spokenSerial(credit.slip),
      mentions: [`slip:${credit.slip}`],
    };
  }
  return values;
}

/** Templates that apply to this line: the right PAY variant, and one DEDUCTION or CREDIT per item it names. */
export function applicableTemplates(
  dto: StatementDTO,
  lang: Lang,
  rail: PayRail,
): readonly StatementTemplate[] {
  return (dto.sentences[lang] ?? []).filter((s) => {
    if (s.slot === "PAY") return (s.variant ?? "paypal") === rail;
    if (s.slot === "DEDUCTION") return dto.amounts.deductions.some((d) => d.ruleId === s.ref);
    if (s.slot === "CREDIT") return dto.amounts.credits.some((c) => c.slip === s.ref);
    return true;
  });
}

/** The member's sentences, filled; rejected ones are dropped and reported so the server can regenerate them. */
export function statementSentences(dto: StatementDTO, lang: Lang, rail?: PayRail) {
  const r: PayRail = rail ?? (dto.rail === "CASH" ? "cash" : "paypal");
  const filled = applicableTemplates(dto, lang, r).map((s) =>
    fillSentence(s, statementValues(dto, lang, s, r)),
  );
  return {
    sentences: filled.filter((f): f is Extract<FilledSentence, { ok: true }> => f.ok),
    rejected: filled.filter((f): f is Extract<FilledSentence, { ok: false }> => !f.ok),
  };
}

export type StatementSentence = ReturnType<typeof statementSentences>["sentences"][number];
