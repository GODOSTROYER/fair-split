// Deterministic formatting (register C-22): never `Intl`, never locale-dependent, so the server,
// the browser, the phone and the film print identical strings. UI code receives these strings in
// DTOs (`display`), because UI may not import `domain` directly.
import type { Lang } from "@fairsplit/contracts";
import { type FxRate, mulDivHalfUp } from "./money.js";

const MINUS = "−";

/** "4333" → "4,333". */
export function groupThousands(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ",";
  }
  return out;
}

/** A non-negative integer scaled by 10^decimals, printed with grouping: (978060, 2) → "9,780.60". */
function scaled(value: number, decimals: number, group = true): string {
  const abs = Math.abs(value);
  const s = String(abs).padStart(decimals + 1, "0");
  const intPart = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? `.${s.slice(s.length - decimals)}` : "";
  return `${value < 0 ? MINUS : ""}${group ? groupThousands(intPart) : intPart}${frac}`;
}

/** Rounds n / 10^drop half away from zero. */
function roundDrop(n: number, drop: number): number {
  if (drop <= 0) return n * 10 ** -drop;
  const neg = n < 0;
  const r = mulDivHalfUp(Math.abs(n), 1, 10 ** drop);
  return neg ? -r : r;
}

/** "US$4,333.50", "−US$1.09"; PHP centavos as "₱4,028.13". */
export function money(minor: number, currency: "USD" | "PHP" = "USD"): string {
  const symbol = currency === "USD" ? "US$" : "₱";
  const body = scaled(Math.abs(minor), 2);
  return `${minor < 0 ? MINUS : ""}${symbol}${body}`;
}

/** Plain two-place amount, as on the ReceiptBar: "43.69", "4,333.50", "−1.09". */
export function amount(cents: number): string {
  return scaled(cents, 2);
}

/** Whole pesos from centavos, half-up: 402,812 centavos → "₱4,028". */
export function pesoWhole(centavos: number): string {
  const pesos = roundDrop(centavos, 2);
  return `${pesos < 0 ? MINUS : ""}₱${groupThousands(String(Math.abs(pesos)))}`;
}

/** Whole-peso value of a US amount at the run's rate (half-up). Peso figures are never summed. */
export function pesoValueOf(cents: number, fx: FxRate): number {
  return mulDivHalfUp(Math.abs(cents), fx.num, fx.den * 100) * (cents < 0 ? -1 : 1);
}

const ESTIMATE: Readonly<Record<Lang, (p: string) => string>> = {
  ceb: (p) => `mga ${p} (gibanabana)`,
  fil: (p) => `humigit-kumulang ${p} (tantiya)`,
  en: (p) => `about ${p} (estimate)`,
};

/** A peso figure is always labelled as an estimate: "mga ₱4,028 (gibanabana)". */
export function pesoEstimate(cents: number, fx: FxRate, lang: Lang): string {
  const pesos = pesoValueOf(cents, fx);
  return ESTIMATE[lang](`₱${groupThousands(String(Math.abs(pesos)))}`);
}

/** Kilos from grams, half-up at `decimals`: 148,000 g → "148.0 kg"; 9,780,600 g → "9,780.6 kg". */
export function kg(grams: number, decimals = 1): string {
  return `${kgNumber(grams, decimals)} kg`;
}

export function kgNumber(grams: number, decimals = 1): string {
  return scaled(roundDrop(grams, 3 - decimals), decimals);
}

/** Slip box value, two places, no unit: 38,450 g → "38.45". */
export function slipKg(grams: number): string {
  return scaled(roundDrop(grams, 1), 2, false);
}

/** US dollars per kg to five places: (288,750 ¢, 9,780,600 g) → "US$0.29523 a kg". */
export function ratePerKg(cents: number, grams: number, decimals = 5): string {
  if (grams <= 0) throw new RangeError("grams must be positive");
  const v = mulDivHalfUp(cents, 10 ** (decimals + 1), grams);
  return `US$${scaled(v, decimals)} a kg`;
}

/** num/den as a percentage with `decimals` places, half away from zero: (1556, 96250) → "1.62%". */
export function percent(num: number, den: number, decimals = 2): string {
  if (den <= 0) throw new RangeError("den must be positive");
  const v = mulDivHalfUp(Math.abs(num), 100 * 10 ** decimals, den);
  return `${num < 0 ? MINUS : ""}${scaled(v, decimals)}%`;
}

/** Basis points as a percentage: (162) → "1.62%"; (200, 1) → "2.0%". */
export function percentBp(bp: number, decimals = 2): string {
  return `${scaled(roundDrop(bp, 2 - decimals), decimals)}%`;
}

/** Share of value to one decimal: (34,174, 421,817) → "8.1%". */
export function shareOf(part: number, whole: number, decimals = 1): string {
  return percent(part, whole, decimals);
}

/** Hash prefix in groups of four: "7f3a91c2…" → "7f3a 91c2". */
export function hashGroups(hex: string, groups = 2): string {
  const out: string[] = [];
  for (let i = 0; i < groups && i * 4 < hex.length; i++) out.push(hex.slice(i * 4, i * 4 + 4));
  return out.join(" ");
}

/** A whole hash in groups of four, for comparing by eye on two screens. */
export function hashAllGroups(hex: string): string {
  return hashGroups(hex, Math.ceil(hex.length / 4));
}

const MONTHS: Readonly<Record<Lang, readonly string[]>> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ceb: ["Ene", "Peb", "Mar", "Abr", "May", "Hun", "Hul", "Ago", "Set", "Okt", "Nob", "Dis"],
  fil: ["Ene", "Peb", "Mar", "Abr", "May", "Hun", "Hul", "Ago", "Set", "Okt", "Nob", "Dis"],
};

function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new RangeError(`not an ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "30 Oct 2026" (en) or "30 Okt 2026" (ceb, fil). */
export function date(iso: string, lang: Lang = "en"): string {
  const { y, m, d } = parseIsoDate(iso);
  return `${d} ${MONTHS[lang][m - 1]} ${y}`;
}

/** "30 Oct" / "30 Okt". */
export function dateShort(iso: string, lang: Lang = "en"): string {
  const { m, d } = parseIsoDate(iso);
  return `${d} ${MONTHS[lang][m - 1]}`;
}

/** Wall-clock time of an ISO instant at a fixed UTC offset (default Manila, +08:00): "10:21:41". */
export function time(isoDateTime: string, offsetMinutes = 480): string {
  const ms = Date.parse(isoDateTime);
  if (Number.isNaN(ms)) throw new RangeError(`not an ISO date-time: ${isoDateTime}`);
  const t = new Date(ms + offsetMinutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** Adds whole days to an ISO date (UTC calendar arithmetic). */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseIsoDate(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** "0:14", "12:03" — the ring timer under a sent amount. */
export function elapsedClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "3 min 12 s", "45 s", "1 h 2 min". */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
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

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0) parts.push(`${ONES[h]} hundred`);
  if (r > 0) {
    if (r < 20) parts.push(ONES[r] ?? "");
    else parts.push(r % 10 === 0 ? (TENS[r / 10] ?? "") : `${TENS[Math.floor(r / 10)]}-${ONES[r % 10]}`);
  }
  return parts.join(" ");
}

/** English cardinal words, no "and": 4028 → "four thousand twenty-eight". */
export function numberWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("numberWords takes a non-negative integer");
  if (n === 0) return "zero";
  const scales: [number, string][] = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, word] of scales) {
    if (rest >= size) {
      parts.push(`${numberWords(Math.floor(rest / size))} ${word}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

const SPOKEN_ESTIMATE: Readonly<Record<Lang, (pesos: string) => string>> = {
  en: (p) => `about ${p} pesos, estimate`,
  ceb: (p) => `mga ${p} pesos, gibanabana`,
  fil: (p) => `humigit-kumulang ${p} piso, tantiya`,
};

/**
 * Full spoken phrase for screen readers and audio templates. Number words stay English in every
 * language, pending native review (S1.11): "sixty-four dollars and forty-five cents, about four
 * thousand twenty-eight pesos, estimate".
 */
export function amountSpoken(cents: number, lang: Lang, fx?: FxRate): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const c = abs % 100;
  const d = `${numberWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  const cc = `${numberWords(c)} ${c === 1 ? "cent" : "cents"}`;
  let usd = dollars > 0 && c > 0 ? `${d} and ${cc}` : dollars > 0 ? d : cc;
  if (cents < 0) usd = `minus ${usd}`;
  if (!fx) return usd;
  const pesos = Math.abs(pesoValueOf(cents, fx));
  return `${usd}, ${SPOKEN_ESTIMATE[lang](numberWords(pesos))}`;
}

/** Slip numbers are read digit by digit: "0403" → "zero four zero three". */
export function digitsSpoken(digits: string): string {
  return [...digits].map((ch) => (/\d/.test(ch) ? ONES[Number(ch)] : ch)).join(" ");
}

export function memberNo(n: number): string {
  return `M-${String(n).padStart(3, "0")}`;
}

export function serial(n: number): string {
  return String(n).padStart(4, "0");
}

/** Masked receiver for the brand view (C-23): "nangceling@x.example" → "n***@x.example". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export function moneyDTO(
  cents: number,
  currency: "USD" | "PHP" = "USD",
): {
  cents: number;
  currency: "USD" | "PHP";
  display: string;
} {
  return { cents, currency, display: money(cents, currency) };
}

export function kgDTO(grams: number, decimals = 1): { grams: number; display: string } {
  return { grams, display: kg(grams, decimals) };
}

/** Kilos per tree to two places from grams and trees: (300,000 g, 140) → "2.14". */
export function kgPerTree(grams: number, trees: number): string {
  if (trees <= 0) return "∞";
  return scaled(mulDivHalfUp(grams, 1, trees * 10), 2);
}
