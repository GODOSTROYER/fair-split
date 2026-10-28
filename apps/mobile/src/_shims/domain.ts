/**
 * IC-02 as the app needs it. Two halves, kept apart on purpose:
 *
 * - The digests (register §8 as amended: `batchDigest`, `linesDigest`, the line hashes, JCS) are WS-CORE's own
 *   code, copied byte for byte into `domain-core.ts` and re-exported here. @fairsplit/domain may not reach UI code
 *   (register §6) and hashes with node:crypto, so a copy guarded by `domain-core.parity.test.ts` is the only way the
 *   phone computes exactly what fs-api and the Proof compute.
 * - `format.*` (C-22: a deterministic formatter, never `Intl`), `FEE_TABLE` and `fsm.item` are still the app's:
 *   UI code receives display strings from fs-api (contracts `MoneyDTO.display`) and never calls the package's
 *   formatter, so they stay here until WS-API serves every string the screens show.
 *
 * Pure, no IO, no React Native.
 */
import type { ItemStatus, Lang } from "./contracts";
import { ITEM_STATUS_RANK } from "./contracts";

export {
  approvalBytes,
  type BatchCanonical,
  type BatchRun,
  batchCanonical,
  batchDigest,
  jcs,
  jcsBytes,
  jcsSha256,
  linesDigest,
  linesRootJcs,
  parseSenderItemId,
  sha256Hex,
} from "./domain-core";

/* ------------------------------------------------------------------ FEE_TABLE (S1.8, C-28) */

/**
 * What a member pays outside the co-op to turn a PayPal balance into pesos. Published rates, shown as rates and
 * labelled with their source; they are never deductions and never computed into her line.
 */
export const FEE_TABLE = {
  paypalConversionBp: 300,
  paypalSource: "PayPal Philippines business fees, updated 28 Sep 2026",
  gcashTransferBp: 100,
  gcashSource: "GCash cash-in fees, since 7 Mar 2026",
} as const;

/* ------------------------------------------------------------------ fsm.item (I5) */

export const fsm = {
  item: {
    rank: (s: ItemStatus): number => ITEM_STATUS_RANK[s],
    /**
     * Forward-only application of a payout-item status. RETURNED is accepted only after our own cancel
     * (UNCLAIMED → RETURNED with `ownCancel`), never from an arbitrary event.
     */
    apply(
      current: ItemStatus | null,
      next: ItemStatus,
      opts: { ownCancel?: boolean } = {},
    ): ItemStatus | null {
      if (current === null) return next === "RETURNED" && !opts.ownCancel ? null : next;
      if (next === "RETURNED") return current === "UNCLAIMED" && opts.ownCancel ? "RETURNED" : null;
      return ITEM_STATUS_RANK[next] > ITEM_STATUS_RANK[current] ? next : null;
    },
  },
} as const;

/* ------------------------------------------------------------------ format.* */

const MONTHS: Readonly<Record<Lang, readonly string[]>> = {
  ceb: ["Ene", "Peb", "Mar", "Abr", "May", "Hun", "Hul", "Ago", "Set", "Okt", "Nob", "Dis"],
  fil: ["Ene", "Peb", "Mar", "Abr", "May", "Hun", "Hul", "Ago", "Set", "Okt", "Nob", "Dis"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const MINUS = "−";
/** The co-op keeps Philippine time (UTC+8, no daylight saving), so dates never depend on the phone's zone. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function group3(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function manila(iso: string): Date {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Not a date: ${iso}`);
  return new Date(t + MANILA_OFFSET_MS);
}

/** Integer cents → "64.45" (no currency), with U+2212 for negatives. */
function plain(cents: number): string {
  if (!Number.isInteger(cents)) throw new RangeError("Money is integer cents");
  const sign = cents < 0 ? MINUS : "";
  const abs = Math.abs(cents);
  return `${sign}${group3(Math.floor(abs / 100))}.${pad2(abs % 100)}`;
}

/** Centavos per US dollar from a "62.50" reference rate. */
function centavosPerUsd(phpPerUsd: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(phpPerUsd);
  if (!m) throw new RangeError(`Bad rate: ${phpPerUsd}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/**
 * The PayPal peso estimate in whole pesos, floored (approved plan: "about ₱4,028 (estimate)", run rate ₱62.50,
 * floored), so an estimate never promises a centavo more than the rate gives.
 */
function pesoWhole(cents: number, phpPerUsd: string): number {
  const centavos100 = Math.abs(cents) * centavosPerUsd(phpPerUsd); // centavos × 100
  return Math.floor(centavos100 / 10000);
}

/** Exact cash centavos at the run's recorded rate, half-up to the centavo ("₱7,990.00"). */
function cashCentavos(cents: number, phpPerUsd: string): number {
  const centavos100 = Math.abs(cents) * centavosPerUsd(phpPerUsd);
  return Math.floor((centavos100 + 50) / 100);
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
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${words(n % 100)}` : ""}`;
  if (n < 1_000_000) {
    return `${words(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
  }
  return `${words(Math.floor(n / 1_000_000))} million${n % 1_000_000 ? ` ${words(n % 1_000_000)}` : ""}`;
}

export const format = {
  /** "US$64.45", "US$4,333.50", "−US$1.09". */
  usd(cents: number): string {
    const p = plain(cents);
    return p.startsWith(MINUS) ? `${MINUS}US$${p.slice(1)}` : `US$${p}`;
  },
  /** "43.69", "−1.09": amounts inside the receipt bar and rule chips. */
  usdPlain: plain,
  /** "mga ₱4,028 (gibanabana)" / "humigit-kumulang ₱4,028 (tantiya)" / "about ₱4,028 (estimate)". */
  pesoEstimate(cents: number, phpPerUsd: string, lang: Lang): string {
    const p = `₱${group3(pesoWhole(cents, phpPerUsd))}`;
    if (lang === "ceb") return `mga ${p} (gibanabana)`;
    if (lang === "fil") return `humigit-kumulang ${p} (tantiya)`;
    return `about ${p} (estimate)`;
  },
  /** "₱4,028": the bare peso figure for templates that carry their own "about" word. */
  peso(cents: number, phpPerUsd: string): string {
    return `₱${group3(pesoWhole(cents, phpPerUsd))}`;
  },
  /**
   * Full spoken phrase for screen readers and device speech (S1.11). Ceb and fil keep English number words
   * pending native review.
   */
  amountSpoken(cents: number, phpPerUsd?: string): string {
    const abs = Math.abs(cents);
    const d = Math.floor(abs / 100);
    const c = abs % 100;
    const dollars = `${words(d)} dollar${d === 1 ? "" : "s"}`;
    const usd = c ? `${dollars} and ${words(c)} cent${c === 1 ? "" : "s"}` : dollars;
    const lead = cents < 0 ? `minus ${usd}` : usd;
    if (!phpPerUsd) return lead;
    const p = pesoWhole(cents, phpPerUsd);
    return `${lead}, about ${words(p)} peso${p === 1 ? "" : "s"}, estimate`;
  },
  /** "four thousand twenty-eight pesos": the peso estimate as words, for device speech. */
  pesoSpoken(cents: number, phpPerUsd: string): string {
    const p = pesoWhole(cents, phpPerUsd);
    return `${words(p)} peso${p === 1 ? "" : "s"}`;
  },
  /**
   * Cash at the bodega, exact at the run's recorded rate: "₱7,990.00" (S1.8). Unlike the PayPal estimate this is
   * the amount handed over, so it carries centavos and no "about".
   */
  cashPesos(cents: number, phpPerUsd: string): string {
    const c = cashCentavos(cents, phpPerUsd);
    return `₱${group3(Math.floor(c / 100))}.${pad2(c % 100)}`;
  },
  /** "seven thousand nine hundred ninety pesos, cash" (S1.12), for screen readers and device speech. */
  cashSpoken(cents: number, phpPerUsd: string): string {
    const c = cashCentavos(cents, phpPerUsd);
    const p = Math.floor(c / 100);
    const cv = c % 100;
    const pesos = `${words(p)} peso${p === 1 ? "" : "s"}`;
    return `${cv ? `${pesos} and ${words(cv)} centavo${cv === 1 ? "" : "s"}` : pesos}, cash`;
  },
  /** A published rate in basis points: 300 → "3%", 440 → "4.40%". */
  percentBp(bp: number): string {
    if (!Number.isInteger(bp) || bp < 0) throw new RangeError("Rates are whole basis points");
    return bp % 100 === 0 ? `${bp / 100}%` : `${Math.floor(bp / 100)}.${pad2(bp % 100)}%`;
  },
  /** Grams → "148.0 kg" (1 dp) or "38.45 kg" (2 dp), half-up. */
  kg(grams: number, dp: 1 | 2 = 1): string {
    const scale = dp === 1 ? 100 : 10;
    const units = Math.floor((Math.abs(grams) + scale / 2) / scale); // tenths or hundredths of a kg
    const div = dp === 1 ? 10 : 100;
    const whole = Math.floor(units / div);
    const frac = String(units % div).padStart(dp, "0");
    return `${grams < 0 ? MINUS : ""}${group3(whole)}.${frac} kg`;
  },
  /** "30 Okt 2026" (ceb, fil) or "30 Oct 2026" (en), in Philippine time. */
  date(iso: string, lang: Lang): string {
    const d = manila(iso);
    return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  },
  /** "30 Okt". */
  dayMonth(iso: string, lang: Lang): string {
    const d = manila(iso);
    return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}`;
  },
  /** "09:12" in Philippine time. */
  time(iso: string): string {
    const d = manila(iso);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  },
  /** "0:14", "12:03"; past an hour "1:02:03". */
  elapsed(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
  },
  /** Hash in groups of four: "7f3a 91c2" (first `groups`), or all of it when `groups` is omitted. */
  hash(hex: string, groups?: number): string {
    const parts = hex.toLowerCase().match(/.{1,4}/g) ?? [];
    return (groups ? parts.slice(0, groups) : parts).join(" ");
  },
  /** "412 KB", "1.2 MB". */
  bytes(n: number): string {
    if (n < 1000) return `${n} B`;
    if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
    return `${(Math.round(n / 100_000) / 10).toFixed(1)} MB`;
  },
  /** "0403, 0419, 0436 ug 0467". */
  list(items: readonly string[], lang: Lang): string {
    const and = lang === "ceb" ? "ug" : lang === "fil" ? "at" : "and";
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
  },
} as const;
