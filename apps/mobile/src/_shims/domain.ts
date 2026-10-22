/**
 * TEMPORARY SHIM: replace with @fairsplit/domain (re-exported through @fairsplit/api-client) after WS-CORE merges.
 *
 * The subset of IC-02 the app needs: `format.*` (C-22: a deterministic formatter, never `Intl`), `batchDigest`
 * (register §8) and the payout-item rank rule `fsm.item` (register §7). Pure, no IO, no React Native.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import canonicalize from "canonicalize";
import type { BatchItem, ItemStatus, Lang } from "./contracts";
import { ITEM_STATUS_RANK } from "./contracts";

/* ------------------------------------------------------------------ hashing */

/** RFC 8785 (JCS) canonical JSON. Throws on values JCS cannot represent. */
export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("Value cannot be canonicalised (RFC 8785)");
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

/** batchSha256 = sha256(JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId}) (register §8). */
export function batchDigest(
  run: { runId: string; senderBatchId: string; rateCardSha256: string },
  items: readonly BatchItem[],
): string {
  const sorted = [...items]
    .map(({ senderItemId, receiver, amountCents, currency }) => ({
      senderItemId,
      receiver,
      amountCents,
      currency,
    }))
    .sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
  return sha256Hex(
    jcs({
      runId: run.runId,
      senderBatchId: run.senderBatchId,
      rateCardSha256: run.rateCardSha256,
      items: sorted,
    }),
  );
}

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

/** Peso estimate in whole pesos, half-up, from cents and a "62.50" pesos-per-dollar reference rate. */
function pesoWhole(cents: number, phpPerUsd: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(phpPerUsd);
  if (!m) throw new RangeError(`Bad rate: ${phpPerUsd}`);
  const centavosPerUsd = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  const centavos2 = Math.abs(cents) * centavosPerUsd; // centavos × 100
  return Math.floor((centavos2 + 5000) / 10000);
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
