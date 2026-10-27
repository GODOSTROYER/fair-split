// TEMPORARY SHIM: replace with @fairsplit/domain after WS-CORE merges.
// Mirrors IC-02 `agreement(a, b, zoom?)` and the S4.2 normalisers, validators and row checks
// (register §9 AI-2 gate: 0.97 / 0.88 / 0.60 overwritten / 0.40 triggers a zoom / 0.80 / 0;
// auto-accept at 0.85 or above). Pure: no IO, no clock.
import type { KiloField } from "../fields.js";
import type { Legibility, RowField } from "../schema.js";

export const AUTO_ACCEPT_AT = 0.85;
export const SCORE = {
  CLEAR_PAIR: 0.97,
  ONE_SMUDGED: 0.88,
  OVERWRITTEN: 0.6,
  ZOOM: 0.4,
  ZOOM_AGREES: 0.8,
  PERSON: 0,
} as const;

// ---------------------------------------------------------------------------------------------
// Normalisers (S4.2 table)
// ---------------------------------------------------------------------------------------------

/** A normalised value: `key` decides equality, `value` is the display form. */
export interface Norm {
  key: string;
  value: string;
  /** Integer grams for kilo fields, tenths for mc_pct. */
  n?: number;
}

const HONORIFICS = new Set([
  "NANG",
  "NONG",
  "MANG",
  "ALING",
  "MANONG",
  "MANANG",
  "MR",
  "MRS",
  "MS",
  "MISS",
  "GNG",
]);

export function normaliseName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/["“”][^"“”]*["“”]/g, " ") // quoted nicknames
    .replace(/[^A-ZÑ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !HONORIFICS.has(w))
    .join(" ");
}

/** Decimal string → integer thousandths, exactly (no floating point). */
function toThousandths(s: string): number | undefined {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return undefined;
  return Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
}

export function normaliseKilos(raw: string): Norm | null {
  const s = raw
    .trim()
    .replace(/\s*kgs?\.?$/i, "")
    .replace(",", ".")
    .replace(/\s+/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const grams = toThousandths(s);
  if (grams === undefined) return null;
  const value = `${Math.floor(grams / 1000)}.${String(grams % 1000)
    .padStart(3, "0")
    .slice(0, 2)}`;
  return { key: String(grams), value, n: grams };
}

export function normaliseDate(raw: string): Norm | null {
  const s = raw.trim();
  let y: number;
  let mo: number;
  let d: number;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    mo = Number(m[1]);
    d = Number(m[2]);
    y = m[3]?.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { key: iso, value: iso };
}

export function normaliseField(field: RowField, raw: string): Norm | null {
  const t = raw.trim();
  if (!t || t.includes("?")) return null;
  switch (field) {
    case "serial": {
      const digits = t.replace(/^No\.?\s*/i, "").replace(/\s+/g, "");
      if (!/^\d{1,4}$/.test(digits)) return null;
      const v = digits.padStart(4, "0");
      return { key: v, value: v };
    }
    case "line_no": {
      if (!/^\d{1,3}$/.test(t)) return null;
      const v = String(Number(t));
      return { key: v, value: v };
    }
    case "date":
      return normaliseDate(t);
    case "member_no": {
      const m = /^M?\s*-?\s*(\d{1,3})$/i.exec(t);
      if (!m?.[1]) return null;
      const v = `M-${m[1].padStart(3, "0")}`;
      return { key: v, value: v };
    }
    case "member_name": {
      const v = normaliseName(t);
      return v ? { key: v, value: v } : null;
    }
    case "plot_no": {
      const v = t.toUpperCase().replace(/\s+/g, "");
      return { key: v, value: v };
    }
    case "sacks": {
      const m = /^(\d)\s*(PP|JUTE|BALDI)$/i.exec(t.replace(/\s+/g, " "));
      if (!m) return null;
      const v = `${m[1]} ${m[2]?.toUpperCase()}`;
      return { key: v, value: v };
    }
    case "gross_kg":
    case "tare_kg":
    case "net_kg":
    case "mc_less_kg":
    case "payable_kg":
      return normaliseKilos(t);
    case "mc_pct": {
      const s = t.replace(/\s*%$/, "").replace(",", ".");
      if (!/^\d{1,2}(\.\d)?$/.test(s)) return null;
      const tenths = Math.round((toThousandths(s) ?? Number.NaN) / 100);
      if (!Number.isFinite(tenths)) return null;
      const v = `${Math.floor(tenths / 10)}.${tenths % 10}`;
      return { key: String(tenths), value: v, n: tenths };
    }
    case "grade": {
      const s = t
        .toUpperCase()
        .replace(/^GRADO\s*|^GRADE\s*/, "")
        .replace(/\s+/g, "");
      const v =
        s === "G1" || s === "1" || s === "I"
          ? "G1"
          : s === "G2" || s === "2" || s === "II"
            ? "G2"
            : s === "OFF"
              ? "OFF"
              : null;
      return v ? { key: v, value: v } : null;
    }
    case "clerk_initials": {
      const v = t.toUpperCase().replace(/[^A-Z]/g, "");
      return v ? { key: v, value: v } : null;
    }
  }
}

/** Deduction lines: trimmed, spaces collapsed, P/PHP → ₱ before an amount (S4.2). */
export function normaliseDeduction(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(?:PHP|Php|php|P)\s?(?=\d)/g, "₱")
    .replace(/₱\s+/g, "₱");
}

// ---------------------------------------------------------------------------------------------
// Validators (S4.2 table)
// ---------------------------------------------------------------------------------------------

export interface RegistryMember {
  memberNo: string;
  name: string;
}

export interface ValidationContext {
  /** Inclusive serial pad range for the season, e.g. 301..563. */
  serialRange?: { lo: number; hi: number };
  /** Inclusive ISO dates. Default: Season 2026-A, 2026-04-01 to 2026-08-31. */
  season?: { from: string; to: string };
  /** Member registry; when absent, member_no and member_name are format-checked only. */
  registry?: ReadonlyMap<string, RegistryMember>;
}

export const SEASON_2026A = { from: "2026-04-01", to: "2026-08-31" } as const;

/** Returns null when valid, otherwise the reason. `memberNo` is the row's member for the name check. */
export function validateField(
  field: RowField,
  norm: Norm,
  ctx: ValidationContext,
  memberNo?: string,
): string | null {
  switch (field) {
    case "serial": {
      if (!/^\d{4}$/.test(norm.value)) return "serial is not four digits";
      const r = ctx.serialRange;
      const n = Number(norm.value);
      return r && (n < r.lo || n > r.hi) ? "serial outside the season's pad range" : null;
    }
    case "date": {
      const s = ctx.season ?? SEASON_2026A;
      return norm.value < s.from || norm.value > s.to ? "date outside the season" : null;
    }
    case "member_no":
      if (!/^M-\d{3}$/.test(norm.value)) return "member number format";
      return ctx.registry && !ctx.registry.has(norm.value) ? "member not in the registry" : null;
    case "member_name": {
      if (!ctx.registry || !memberNo) return null;
      const member = ctx.registry.get(memberNo);
      if (!member) return "no registry name for the member number";
      return jaroWinkler(norm.value, normaliseName(member.name)) >= 0.88
        ? null
        : "name does not match the registry";
    }
    case "plot_no":
      return /^P-\d{3}-[A-Z]$/.test(norm.value) ? null : "plot number format";
    case "sacks": {
      const n = Number(norm.value.split(" ")[0]);
      return n >= 1 && n <= 9 ? null : "sack count outside 1-9";
    }
    case "gross_kg":
    case "tare_kg":
    case "net_kg":
    case "mc_less_kg":
    case "payable_kg":
      return (norm.n ?? Number.POSITIVE_INFINITY) <= 400_000 ? null : "more than 400 kg";
    case "mc_pct":
      return (norm.n ?? 0) >= 40 && (norm.n ?? 0) <= 120 ? null : "moisture outside 4.0-12.0%";
    case "grade":
      return null;
    case "line_no":
      return Number(norm.value) >= 1 ? null : "line number";
    case "clerk_initials":
      return /^[A-Z]{2,3}$/.test(norm.value) ? null : "initials";
  }
}

/** Row checks: gross − tare = net and net − mc_less = payable, each within ±10 g. Returns failing fields. */
export function rowCheckFailures(grams: Partial<Record<KiloField, number>>): Set<KiloField> {
  const failed = new Set<KiloField>();
  const { gross_kg: g, tare_kg: t, net_kg: n, mc_less_kg: l, payable_kg: p } = grams;
  if (g !== undefined && t !== undefined && n !== undefined && Math.abs(g - t - n) > 10) {
    failed.add("gross_kg").add("tare_kg").add("net_kg");
  }
  if (n !== undefined && l !== undefined && p !== undefined && Math.abs(n - l - p) > 10) {
    failed.add("net_kg").add("mc_less_kg").add("payable_kg");
  }
  return failed;
}

// ---------------------------------------------------------------------------------------------
// Agreement (IC-02)
// ---------------------------------------------------------------------------------------------

/** One read of one field, prepared for scoring: normalised key plus whether every check passed. */
export interface ScoredRead {
  legibility: Legibility;
  raw: string;
  norm: Norm | null;
  /** Validators, row checks and the box-in-rectangle check all passed. */
  valid: boolean;
}

export type AgreementState = "AUTO_ACCEPTED" | "NEEDS_ZOOM" | "ONE_TAP" | "PERSON_TYPES";

export interface AgreementOutcome {
  score: number;
  /** Row of the S4.2 agreement table that decided (1-7). */
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  state: AgreementState;
  /** The proposed value (normalised display form when available). */
  value: string;
  /** Who produced the proposed value. */
  decidedBy: "agreement" | "zoom" | "person";
  /** Per-character merge of reads A and B ("6?.80"). */
  display: string;
}

const sameKey = (x: ScoredRead, y: ScoredRead) =>
  x.norm !== null && y.norm !== null && x.norm.key === y.norm.key;

/** Per-character merge: "?" wherever the reads differ or either has "?". */
export function mergeDisplay(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  let out = "";
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ca = a[i];
    const cb = b[i];
    out += ca !== undefined && ca === cb && ca !== "?" ? ca : "?";
  }
  return out;
}

/**
 * Scores one field. The first matching row of the table wins. Returns null when the field is
 * optional and ABSENT in both reads (it is skipped, not scored).
 */
export function agreement(
  a: ScoredRead,
  b: ScoredRead,
  zoom?: ScoredRead,
  opts: { required: boolean } = { required: true },
): AgreementOutcome | null {
  const display = mergeDisplay(a.raw, b.raw);
  const shown = (r: ScoredRead) => r.norm?.value ?? r.raw;
  if (!opts.required && a.legibility === "ABSENT" && b.legibility === "ABSENT") return null;
  // 1. Either read ILLEGIBLE, or a required field ABSENT.
  if (
    a.legibility === "ILLEGIBLE" ||
    b.legibility === "ILLEGIBLE" ||
    (opts.required && (a.legibility === "ABSENT" || b.legibility === "ABSENT"))
  ) {
    return { score: SCORE.PERSON, rule: 1, state: "PERSON_TYPES", value: "", decidedBy: "person", display };
  }
  // 2. Either read OVERWRITTEN: a person, always.
  if (a.legibility === "OVERWRITTEN" || b.legibility === "OVERWRITTEN") {
    return {
      score: SCORE.OVERWRITTEN,
      rule: 2,
      state: "PERSON_TYPES",
      value: shown(a),
      decidedBy: "person",
      display,
    };
  }
  const agreeValid = sameKey(a, b) && a.valid && b.valid;
  // 3. A = B, both CLEAR, all checks pass.
  if (agreeValid && a.legibility === "CLEAR" && b.legibility === "CLEAR") {
    return {
      score: SCORE.CLEAR_PAIR,
      rule: 3,
      state: "AUTO_ACCEPTED",
      value: shown(a),
      decidedBy: "agreement",
      display,
    };
  }
  // 4. A = B, exactly one SMUDGED, all checks pass.
  const smudged = Number(a.legibility === "SMUDGED") + Number(b.legibility === "SMUDGED");
  const clear = Number(a.legibility === "CLEAR") + Number(b.legibility === "CLEAR");
  if (agreeValid && smudged === 1 && clear === 1) {
    return {
      score: SCORE.ONE_SMUDGED,
      rule: 4,
      state: "AUTO_ACCEPTED",
      value: shown(a),
      decidedBy: "agreement",
      display,
    };
  }
  // 5. Anything else: zoom.
  if (!zoom)
    return { score: SCORE.ZOOM, rule: 5, state: "NEEDS_ZOOM", value: shown(a), decidedBy: "person", display };
  // 6. After zoom: zoom CLEAR, valid, equal to A or B.
  if (zoom.legibility === "CLEAR" && zoom.valid && (sameKey(zoom, a) || sameKey(zoom, b))) {
    return {
      score: SCORE.ZOOM_AGREES,
      rule: 6,
      state: "ONE_TAP",
      value: shown(zoom),
      decidedBy: "zoom",
      display,
    };
  }
  // 7. After zoom: anything else.
  return { score: SCORE.ZOOM, rule: 7, state: "PERSON_TYPES", value: shown(a), decidedBy: "person", display };
}

export const isAutoAccepted = (o: AgreementOutcome | null): boolean =>
  o !== null && o.score >= AUTO_ACCEPT_AT;

// ---------------------------------------------------------------------------------------------
// Jaro-Winkler (member_name validator)
// ---------------------------------------------------------------------------------------------

export function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array<boolean>(len1).fill(false);
  const m2 = new Array<boolean>(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, len2);
    for (let j = lo; j < hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2) && s1[i] === s2[i]; i++) prefix++;
  return jaro + prefix * prefixScale * (1 - jaro);
}
