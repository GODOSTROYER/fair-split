// Stand-ins for packages/domain's deterministic `format.*` (C-22), which the UI may not import: the real
// DTOs will carry these strings. Integer cents in, display and spoken strings out; never Intl.

import type { MoneyView } from "@fairsplit/ui-web";

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 6445 → "US$64.45"; negatives use the minus sign. */
export function usd(cents: number, options: { sign?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const text = `US$${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  if (cents < 0) return `−${text}`;
  return options.sign ? `+${text}` : text;
}

/** 6445 → "64.45" (grid cells, where the column says the currency). */
export function plain(cents: number): string {
  const abs = Math.abs(cents);
  const text = `${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `−${text}` : text;
}

/** Pesos as the rate card states them, in centavos: 500000 → "₱5,000", 150 → "₱1.50". Never an estimate. */
export function php(centavos: number): string {
  const whole = `₱${group(Math.floor(centavos / 100))}`;
  return centavos % 100 === 0 ? whole : `${whole}.${String(centavos % 100).padStart(2, "0")}`;
}

/** The peso estimate at the run's reference rate (₱62.50), rounded to the peso. Peso figures are never summed. */
export function phpEstimate(cents: number, rate = 62.5): string {
  return `₱${group(Math.round((cents / 100) * rate))}`;
}

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

function words(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)] ?? "";
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${words(rest)}` : ""}`;
  }
  const rest = n % 1000;
  return `${words(Math.floor(n / 1000))} thousand${rest ? ` ${words(rest)}` : ""}`;
}

/** 6445 → "sixty-four dollars and forty-five cents" (English number words, pending native review). */
export function usdSpoken(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const c = abs % 100;
  const d = `${words(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  const text = c ? `${d} and ${words(c)} ${c === 1 ? "cent" : "cents"}` : d;
  return cents < 0 ? `minus ${text}` : text;
}

export function money(cents: number, options: { sign?: boolean } = {}): MoneyView {
  return { display: usd(cents, options), spoken: usdSpoken(cents) };
}

/** 148.0 kg (one decimal, as the slips record weight). */
export function kg(tenths: number): string {
  return `${group(Math.floor(tenths / 10))}.${tenths % 10} kg`;
}

export function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

/** "7f3a 91c2": a hash in groups of four for people to compare. */
export function hashPrefix(hex: string, groups = 2): string {
  return Array.from({ length: groups }, (_, i) => hex.slice(i * 4, i * 4 + 4)).join(" ");
}
