// CLDR cardinal plural rules for the three languages, in plain code (S1 §1.12): Hermes and older Android ICU
// may not ship Cebuano data, and Filipino and Cebuano share one rule. Most ceb and fil nouns do not inflect
// ("3 ka resibo"), so their catalogs avoid plural selectors; native code that needs a category uses this.

export type PluralCategory = "one" | "other";

/** CLDR operands for a number written as `value` (a string keeps its visible fraction digits). */
function operands(value: number | string): { i: number; v: number; f: number } {
  const text = typeof value === "number" ? String(Math.abs(value)) : value.replace(/^-/, "");
  const [int = "0", frac = ""] = text.split(".");
  return { i: Number(int), v: frac.length, f: frac.length ? Number(frac) : 0 };
}

/**
 * fil and ceb: one when v = 0 and i = 1,2,3; or v = 0 and i % 10 ≠ 4,6,9; or v ≠ 0 and f % 10 ≠ 4,6,9.
 * en: one when i = 1 and v = 0.
 */
export function pluralCategory(lang: "ceb" | "fil" | "en", value: number | string): PluralCategory {
  const { i, v, f } = operands(value);
  if (lang === "en") return i === 1 && v === 0 ? "one" : "other";
  const notFourSixNine = (n: number) => ![4, 6, 9].includes(n % 10);
  if (v === 0 && (i === 1 || i === 2 || i === 3)) return "one";
  if (v === 0 && notFourSixNine(i)) return "one";
  if (v !== 0 && notFourSixNine(f)) return "one";
  return "other";
}
