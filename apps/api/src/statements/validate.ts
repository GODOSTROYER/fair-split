// Statement template validators (S4.5 "Validators", plan amendment: currency nouns allowed). A template, or a
// committed AI-8 variant, is words and {{PLACEHOLDERS}} only:
//   - no digit outside {{…}} (I1: every number comes from a code-rendered fact);
//   - no number word (English stays the spoken number language in every statement, so English number words are
//     refused in all three languages, plus each language's own); currency nouns ("dollar", "piso") are allowed;
//   - placeholders all in the enum, and exactly the set the template key declares;
//   - no "error" or "fraud" in member copy (S1.11 word list);
//   - the demo AI_NOTE (T1, `AI_NOTE.seeded*`) keeps its v1 words exactly: no committed variant may reword the
//     disclosure that the slip readings are a stand-in, or swap in the Claude claim.
import { TEMPLATE_PLACEHOLDERS, TEMPLATES_V1 } from "./templates.js";
import { type Lang, PLACEHOLDERS, type TemplateSet } from "./types.js";

const EN_NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
  "percent",
];

export const NUMBER_WORDS: Readonly<Record<Lang, readonly string[]>> = {
  en: EN_NUMBER_WORDS,
  ceb: [
    ...EN_NUMBER_WORDS,
    "usa",
    "duha",
    "tulo",
    "upat",
    "lima",
    "unom",
    "pito",
    "walo",
    "siyam",
    "napulo",
    "gatos",
    "libo",
    "porsiyento",
  ],
  fil: [
    ...EN_NUMBER_WORDS,
    "isa",
    "dalawa",
    "tatlo",
    "apat",
    "lima",
    "anim",
    "pito",
    "walo",
    "siyam",
    "sampu",
    "daan",
    "libo",
    "porsiyento",
  ],
};

const MEMBER_BANNED = ["error", "fraud"];
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;
const KNOWN = new Set<string>(PLACEHOLDERS);

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? "");
}

/** Problems with one template text (empty when it may be shown to a member). */
export function validateTemplate(key: string, text: string, lang: Lang): string[] {
  const problems: string[] = [];
  const words = text.replace(PLACEHOLDER_RE, " ");
  if (/\p{Nd}/u.test(words)) problems.push(`${key}: a digit outside a placeholder`);
  if (/[{}]/.test(words)) problems.push(`${key}: a malformed placeholder`);
  const lower = words.toLowerCase();
  for (const w of NUMBER_WORDS[lang]) {
    if (new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(lower))
      problems.push(`${key}: the number word "${w}"`);
  }
  for (const w of MEMBER_BANNED) {
    if (new RegExp(`(^|[^\\p{L}])${w}`, "u").test(lower))
      problems.push(`${key}: the word "${w}" in member copy`);
  }
  const used = placeholdersOf(text);
  for (const p of used) if (!KNOWN.has(p)) problems.push(`${key}: unknown placeholder {{${p}}}`);
  const declared = TEMPLATE_PLACEHOLDERS[key];
  if (declared) {
    const a = [...new Set(used)].sort().join(",");
    const b = [...new Set(declared)].sort().join(",");
    if (a !== b) problems.push(`${key}: placeholders {${a}} differ from the declared {${b}}`);
  } else {
    problems.push(`${key}: not a known template key`);
  }
  if (key.startsWith("AI_NOTE.seeded") && text !== TEMPLATES_V1[lang][key]) {
    problems.push(`${key}: the demo disclosure is frozen; a committed variant must keep its words`);
  }
  return problems;
}

/** Every problem in a template set; every language must carry every key. */
export function validateTemplates(set: TemplateSet): string[] {
  const problems: string[] = [];
  for (const lang of Object.keys(set) as Lang[]) {
    for (const key of Object.keys(TEMPLATE_PLACEHOLDERS)) {
      const text = set[lang][key];
      if (text === undefined) problems.push(`${lang} ${key}: missing`);
      else problems.push(...validateTemplate(key, text, lang).map((p) => `${lang} ${p}`));
    }
  }
  return problems;
}
