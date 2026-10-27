/**
 * Spoken templates for audio (S4.5): English number words for money and kilos, slip numbers digit by
 * digit. "English numerals for money are common in Davao Bisaya" (design section 8); every template is
 * pending native review (OD-2). Text sent to TTS therefore never contains a digit.
 */

const ONES = [
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
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0 ≤ n < 1,000,000 in English words ("four thousand and twenty-eight"). */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) throw new RangeError(`numberWords: ${n}`);
  if (n < 20) return ONES[n] as string;
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)] as string;
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
  }
  if (n < 1000) {
    const h = `${ONES[Math.floor(n / 100)]} hundred`;
    return n % 100 ? `${h} and ${numberWords(n % 100)}` : h;
  }
  const th = `${numberWords(Math.floor(n / 1000))} thousand`;
  const rest = n % 1000;
  if (!rest) return th;
  return rest < 100 ? `${th} and ${numberWords(rest)}` : `${th} ${numberWords(rest)}`;
}

/** 6445 → "sixty-four dollars and forty-five cents". */
export function spokenUsd(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError(`spokenUsd: ${cents}`);
  const d = Math.floor(cents / 100);
  const c = cents % 100;
  const dollars = `${numberWords(d)} ${d === 1 ? "dollar" : "dollars"}`;
  if (!c) return dollars;
  return `${dollars} and ${numberWords(c)} ${c === 1 ? "cent" : "cents"}`;
}

/** 4028 → "four thousand and twenty-eight pesos" (whole pesos; peso figures are always estimates). */
export function spokenPhp(pesos: number): string {
  return `${numberWords(pesos)} ${pesos === 1 ? "peso" : "pesos"}`;
}

/** "0403" → "zero four zero three". */
export function spokenDigits(s: string): string {
  if (!/^\d+$/.test(s)) throw new RangeError(`spokenDigits: ${s}`);
  return [...s].map((ch) => ONES[Number(ch)]).join(" ");
}

/** True when a string is safe to send to TTS under the statement rules (no digits at all). */
export function hasNoDigits(text: string): boolean {
  return !/\p{Nd}/u.test(text);
}
