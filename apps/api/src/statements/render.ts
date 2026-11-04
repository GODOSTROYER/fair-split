// `renderStatement(plan, mode)`: the one pure renderer behind the app, the 80 mm print, the audio script and the
// SMS preview (plan "Statements", S4.5). It is the only place a statement number becomes text, always through the
// deterministic formatter (C-22): display ("US$64.45", "about ₱4,028 (estimate)"), spoken (English number words
// in every language until native review; slip numbers digit by digit) and SMS (GSM-7, the peso written "P").
import type { Provenance } from "@fairsplit/contracts";
import { format, mulDivFloor, mulDivHalfUp, sha256Hex } from "@fairsplit/domain";
import { payoutStatusPresentation } from "../lib/payout-status.js";
import { gsm7Length, SMS_MAX_SEPTETS } from "./gsm7.js";
import { TEMPLATES_V1 } from "./templates.js";
import type {
  Fact,
  Lang,
  Placeholder,
  PlannedSentence,
  RenderedSentence,
  RenderMode,
  StatementPlan,
  TemplateSet,
} from "./types.js";

export class StatementRenderError extends Error {
  override readonly name = "StatementRenderError";
}

const AND: Readonly<Record<Lang, string>> = { en: "and", ceb: "ug", fil: "at" };

const MONTHS: Readonly<Record<Lang, readonly string[]>> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  ceb: [
    "Enero",
    "Pebrero",
    "Marso",
    "Abril",
    "Mayo",
    "Hunyo",
    "Hulyo",
    "Agosto",
    "Septiyembre",
    "Oktubre",
    "Nobyembre",
    "Disyembre",
  ],
  fil: [
    "Enero",
    "Pebrero",
    "Marso",
    "Abril",
    "Mayo",
    "Hunyo",
    "Hulyo",
    "Agosto",
    "Setyembre",
    "Oktubre",
    "Nobyembre",
    "Disyembre",
  ],
};

const ESTIMATE: Readonly<Record<Lang, (p: string) => string>> = {
  en: (p) => `about ${p} (estimate)`,
  ceb: (p) => `mga ${p} (gibanabana)`,
  fil: (p) => `humigit-kumulang ${p} (tantiya)`,
};
const ESTIMATE_SMS: Readonly<Record<Lang, (p: string) => string>> = {
  en: (p) => `about ${p}`,
  ceb: (p) => `mga ${p}`,
  fil: (p) => `mga ${p}`,
};
const ESTIMATE_SPOKEN: Readonly<Record<Lang, (w: string) => string>> = {
  en: (w) => `about ${w} pesos, estimate`,
  ceb: (w) => `mga ${w} pesos, gibanabana`,
  fil: (w) => `humigit-kumulang ${w} piso, tantiya`,
};
const PESO_NOUN: Readonly<Record<Lang, string>> = { en: "pesos", ceb: "pesos", fil: "piso" };
const CENTAVO_NOUN: Readonly<Record<Lang, string>> = { en: "centavos", ceb: "sentimos", fil: "sentimo" };
const PERCENT_NOUN: Readonly<Record<Lang, string>> = { en: "percent", ceb: "porsiyento", fil: "porsiyento" };
const KILO_NOUN: Readonly<Record<Lang, string>> = { en: "kilos", ceb: "kilos", fil: "kilo" };

const CATEGORY: Readonly<Record<"CBU" | "LOAN" | "ADVANCE", Readonly<Record<Lang, string>>>> = {
  CBU: { en: "CBU, your capital build-up", ceb: "CBU", fil: "CBU" },
  LOAN: { en: "your loan", ceb: "inyong utang", fil: "inyong utang" },
  ADVANCE: { en: "your cash advance", ceb: "inyong abante", fil: "inyong cash advance" },
};

const RESOLUTION_SPOKEN: Readonly<Record<Lang, string>> = {
  en: "the Board's resolution",
  ceb: "resolusyon sa Board",
  fil: "resolusyon ng Board",
};

const GRADE_ALL: Readonly<Record<Lang, string>> = {
  en: "all Grade 1",
  ceb: "tanan Grade 1",
  fil: "lahat ay Grade 1",
};
const GRADE_NONE: Readonly<Record<Lang, string>> = {
  en: "none of it Grade 1",
  ceb: "walay Grade 1",
  fil: "walang Grade 1",
};
const GRADE_SOME: Readonly<Record<Lang, (kg: string) => string>> = {
  en: (kg) => `${kg} of it Grade 1`,
  ceb: (kg) => `${kg} niini Grade 1`,
  fil: (kg) => `${kg} nito ay Grade 1`,
};

function list(items: readonly string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${AND[lang]} ${items.at(-1)}`;
}

/** Whole pesos from centavos when exact ("₱200"), else two places ("₱200.50"). */
function pesosWritten(centavos: number): string {
  return centavos % 100 === 0
    ? `${centavos < 0 ? "−" : ""}₱${format.groupThousands(String(Math.abs(centavos) / 100))}`
    : format.money(centavos, "PHP");
}

function pesosSpoken(centavos: number, lang: Lang): string {
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const c = abs % 100;
  const p = `${format.numberWords(pesos)} ${PESO_NOUN[lang]}`;
  const out = c === 0 ? p : `${p} ${AND[lang]} ${format.numberWords(c)} ${CENTAVO_NOUN[lang]}`;
  return centavos < 0 ? `minus ${out}` : out;
}

function kgSpoken(grams: number, lang: Lang): string {
  const text = format.kgNumber(grams, 1).replaceAll(",", "");
  const [whole, frac] = text.split(".");
  const w = format.numberWords(Number(whole));
  return frac && frac !== "0"
    ? `${w} point ${format.digitsSpoken(frac)} ${KILO_NOUN[lang]}`
    : `${w} ${KILO_NOUN[lang]}`;
}

function percentText(bp: number): string {
  return format.percentBp(bp, bp % 100 === 0 ? 0 : 2);
}

function percentSpoken(bp: number, lang: Lang): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  const w = format.numberWords(whole);
  const n = frac === 0 ? w : `${w} point ${format.digitsSpoken(String(frac).padStart(2, "0"))}`;
  return `${n} ${PERCENT_NOUN[lang]}`;
}

/** The rate as centavos per US$ (₱62.50 = 6,250), from centavos per cent num/den. */
export function rateCentavosPerUsd(num: number, den: number): number {
  return mulDivHalfUp(100, num, den);
}

/** "about ₱4,028 (estimate)" in the member's language, from the floored estimate's centavos. */
export function estimateText(centavos: number, lang: Lang): string {
  return ESTIMATE[lang](`₱${format.groupThousands(String(Math.floor(Math.max(0, centavos) / 100)))}`);
}

const RATE_LINE: Readonly<Record<Lang, (usd: string, rate: string) => string>> = {
  en: (usd, rate) => `From ${usd} at ${rate} to the dollar`,
  ceb: (usd, rate) => `Gikan sa ${usd} sa ${rate} matag dolyar`,
  fil: (usd, rate) => `Mula sa ${usd} sa ${rate} bawat dolyar`,
};

/** "From US$127.84 at ₱62.50 to the dollar": a cash line's rate, recorded on the run. */
export function rateLine(cents: number, rate: { num: number; den: number }, lang: Lang): string {
  return RATE_LINE[lang](format.money(cents), format.money(rateCentavosPerUsd(rate.num, rate.den), "PHP"));
}

function dateSpoken(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[lang][m - 1]} ${format.numberWords(d)}, ${format.numberWords(y)}`;
}

/** One fact as text in one mode. Every number in a statement passes through here. */
export function renderFact(fact: Fact, mode: RenderMode, lang: Lang): string {
  switch (fact.k) {
    case "usd":
      return mode === "spoken" ? format.amountSpoken(fact.cents, lang) : format.money(fact.cents);
    case "php":
      if (mode === "spoken") return pesosSpoken(fact.centavos, lang);
      return mode === "sms"
        ? format.money(fact.centavos, "PHP").replace("₱", "P")
        : format.money(fact.centavos, "PHP");
    case "php_written":
      if (mode === "spoken") return pesosSpoken(fact.centavos, lang);
      return mode === "sms" ? pesosWritten(fact.centavos).replace("₱", "P") : pesosWritten(fact.centavos);
    case "php_est": {
      // PayPal lines: whole pesos, floored (plan "Pesos"), always labelled as an estimate
      const pesos = Math.floor(fact.centavos / 100);
      if (mode === "spoken") return ESTIMATE_SPOKEN[lang](format.numberWords(pesos));
      const grouped = format.groupThousands(String(pesos));
      return mode === "sms" ? ESTIMATE_SMS[lang](`P${grouped}`) : ESTIMATE[lang](`₱${grouped}`);
    }
    case "kg":
      return mode === "spoken" ? kgSpoken(fact.grams, lang) : format.kg(fact.grams);
    case "grade": {
      if (fact.grade1G >= fact.verifiedG && fact.verifiedG > 0) {
        return mode === "spoken" ? GRADE_ALL[lang].replace("Grade 1", "Grade one") : GRADE_ALL[lang];
      }
      if (fact.grade1G === 0) {
        return mode === "spoken" ? GRADE_NONE[lang].replace("Grade 1", "Grade one") : GRADE_NONE[lang];
      }
      const kg = mode === "spoken" ? kgSpoken(fact.grade1G, lang) : format.kg(fact.grade1G);
      const s = GRADE_SOME[lang](kg);
      return mode === "spoken" ? s.replace("Grade 1", "Grade one") : s;
    }
    case "text":
      return mode === "sms" ? fact.text.replaceAll("₱", "P") : fact.text;
    case "slips":
      if (mode === "sms") return fact.serials.join(",");
      return list(
        fact.serials.map((s) => (mode === "spoken" ? format.digitsSpoken(s) : s)),
        lang,
      );
    case "slip":
      return mode === "spoken" ? format.digitsSpoken(fact.serial) : fact.serial;
    case "rule":
      return mode === "spoken" ? `R ${format.numberWords(Number(fact.id.slice(1)))}` : fact.id;
    case "category":
      return CATEGORY[fact.category][lang];
    case "resolution":
      return mode === "spoken" ? RESOLUTION_SPOKEN[lang] : fact.resolutionNo;
    case "pct":
      return mode === "spoken" ? percentSpoken(fact.bp, lang) : percentText(fact.bp);
    case "date":
      if (mode === "spoken") return dateSpoken(fact.iso, lang);
      return mode === "sms" ? format.dateShort(fact.iso, lang) : format.date(fact.iso, lang);
    case "rate": {
      const centavos = rateCentavosPerUsd(fact.num, fact.den);
      if (mode === "spoken") return pesosSpoken(centavos, lang);
      const text = format.money(centavos, "PHP");
      return mode === "sms" ? text.replace("₱", "P") : text;
    }
  }
}

/** Fills one template with its facts; a placeholder without a fact is a programming error, never "". */
export function fillTemplate(
  template: string,
  facts: Partial<Record<Placeholder, Fact>>,
  mode: RenderMode,
  lang: Lang,
): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, name: string) => {
    const fact = facts[name as Placeholder];
    if (!fact) throw new StatementRenderError(`no fact for {{${name}}}`);
    return renderFact(fact, mode, lang);
  });
}

function templateOf(templates: TemplateSet, lang: Lang, key: string): string {
  const t = templates[lang][key] ?? TEMPLATES_V1[lang][key];
  if (t === undefined) throw new StatementRenderError(`no template ${lang} ${key}`);
  return t;
}

/** Each product AI_NOTE form and its demo twin (T1). */
const AI_NOTE_DEMO: Readonly<Record<string, string>> = {
  default: "seeded",
  noname: "seeded_noname",
  checking: "seeded_checking",
};
const AI_NOTE_DEMO_VARIANTS = new Set(Object.values(AI_NOTE_DEMO));

/**
 * The AI_NOTE variant a statement may carry. Only a real Claude reading (`live`) keeps the product note ("Your
 * slips were read twice by AI (Claude)…"); seeded, replayed, unknown or missing readings take its demo twin ("In
 * this demo, the slip readings are a labelled stand-in…"). A demo note is never upgraded, and a form with no demo
 * twin is refused rather than shown as the claim.
 */
export function aiNoteVariant(variant: string, reading: Provenance | null | undefined): string {
  if (AI_NOTE_DEMO_VARIANTS.has(variant) || reading === "live") return variant;
  const demo = AI_NOTE_DEMO[variant];
  if (!demo) throw new StatementRenderError(`AI_NOTE.${variant} has no demo variant`);
  return demo;
}

function sentence(
  s: PlannedSentence,
  mode: Exclude<RenderMode, "sms">,
  lang: Lang,
  templates: TemplateSet,
  reading: Provenance | null | undefined,
): RenderedSentence {
  const variant = s.slot === "AI_NOTE" ? aiNoteVariant(s.variant, reading) : s.variant;
  const text = fillTemplate(templateOf(templates, lang, `${s.slot}.${variant}`), s.facts, mode, lang);
  return { slot: s.slot, variant, text, mentions: [...s.mentions] };
}

export interface RenderedSms {
  text: string;
  /** Septets in GSM-7, or null when the text is not GSM-7. */
  gsm7Length: number | null;
  fits: boolean;
}

export interface RenderedStatement {
  display: RenderedSentence[];
  spoken: RenderedSentence[];
  sms: RenderedSms;
}

export function renderSms(plan: StatementPlan, templates: TemplateSet = TEMPLATES_V1): RenderedSms {
  let text = fillTemplate(
    templateOf(templates, plan.lang, `sms.${plan.sms.variant}`),
    plan.sms.facts,
    "sms",
    plan.lang,
  );
  const presentation = plan.payout ? payoutStatusPresentation(plan.payout, plan.lang) : null;
  if (presentation?.replayed) {
    // Never wrap "Paid" in a replay prefix: this SMS describes evidence, not payment for this run.
    text = fillTemplate(
      "{{COOP}}: {{HONORIFIC_NAME}}, {{NET_USD}}. Replayed (labelled): earlier simulated PayPal sandbox run; not this run's payment.",
      plan.sms.facts,
      "sms",
      plan.lang,
    );
    if ((gsm7Length(text) ?? Number.POSITIVE_INFINITY) > SMS_MAX_SEPTETS) {
      text = fillTemplate(
        "{{NET_USD}}. Replayed (labelled): earlier simulated PayPal sandbox run; not this run's payment.",
        plan.sms.facts,
        "sms",
        plan.lang,
      );
    }
  } else if (/^(paid|sent)(_|$)/.test(plan.sms.variant)) {
    text += " Simulated PayPal sandbox.";
  }
  const n = gsm7Length(text);
  return { text, gsm7Length: n, fits: n !== null && n <= SMS_MAX_SEPTETS };
}

/** The pure renderer: display, spoken and SMS from one plan (the AI_NOTE by the plan's reading provenance). */
export function renderStatement(
  plan: StatementPlan,
  templates: TemplateSet = TEMPLATES_V1,
): RenderedStatement {
  const reading = plan.readingProvenance;
  return {
    display: plan.sentences.map((s) => sentence(s, "display", plan.lang, templates, reading)),
    spoken: plan.sentences.map((s) => sentence(s, "spoken", plan.lang, templates, reading)),
    sms: renderSms(plan, templates),
  };
}

/**
 * IC-11's `textSha256`: sha256 of a sentence's exact spoken words (UTF-8, lowercase hex). The one hash (ADR-0011 §3):
 * the manifest producer writes `text_sha256` with it (`spokenScript`) and the media route matches clips by it; the
 * app never hashes words, it pairs fs-api's sentences with its own.
 */
export function spokenTextSha256(text: string): string {
  return sha256Hex(text);
}

export interface SpokenSentence extends RenderedSentence {
  textSha256: string;
}

/**
 * The words a statement's audio says, sentence by sentence in plan order, each with its `textSha256`: what the
 * clips are synthesised from (AU2's export). Pure and deterministic: one plan gives the same words and hashes.
 */
export function spokenScript(plan: StatementPlan, templates: TemplateSet = TEMPLATES_V1): SpokenSentence[] {
  return renderStatement(plan, templates).spoken.map((s) => ({ ...s, textSha256: spokenTextSha256(s.text) }));
}

/** The peso estimate's centavos for a US amount at the run rate, floored (PayPal lines). */
export function pesoEstimateCentavos(cents: number, rate: { num: number; den: number }): number {
  return mulDivFloor(Math.max(0, cents), rate.num, rate.den);
}

/** Exact pesos for a cash line at the run's recorded rate, half-up to the centavo. */
export function pesoExactCentavos(cents: number, rate: { num: number; den: number }): number {
  const c = mulDivHalfUp(Math.abs(cents), rate.num, rate.den);
  return cents < 0 ? -c : c;
}
