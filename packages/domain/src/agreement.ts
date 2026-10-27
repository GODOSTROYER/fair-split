// AI-2: two independent reads agree, or a person decides (S4.2). Scores are discrete and computed
// in code; the first matching row of the table wins:
//   1  either read ILLEGIBLE, or a required field ABSENT            0     person types
//   2  either read OVERWRITTEN                                       0.60  person, always
//   3  A = B, both CLEAR, all checks pass                            0.97  auto-accept
//   4  A = B, exactly one SMUDGED, all checks pass                   0.88  auto-accept
//   5  anything else (A ≠ B, both SMUDGED, a check fails)            0.40  zoom (AI-3)
//   6  after zoom: zoom CLEAR, valid, equal to A or B                0.80  one tap confirms
//   7  after zoom: anything else                                     0.40  person types
// Auto-accept needs 0.85 or more. An optional field ABSENT in both reads is skipped.
import type { AgreementResult, FieldRead } from "@fairsplit/contracts";

export const AUTO_ACCEPT = 0.85;
export const SCORES = {
  illegible: 0,
  overwritten: 0.6,
  clear: 0.97,
  oneSmudged: 0.88,
  zoom: 0.4,
  zoomAgrees: 0.8,
} as const;

export interface AgreementOptions {
  /** Required fields are scored; an optional field ABSENT in both reads is skipped. Default true. */
  required?: boolean;
  /** Row checks (gross − tare = net, net − mc_less = payable) and the field validator. Default true. */
  checksPass?: boolean;
  /** Normaliser applied before comparing; null means the value cannot be normalised. */
  normalise?: (raw: string) => string | null;
  /** Validator for the normalised value (used for the zoom read). */
  valid?: (value: string) => boolean;
}

/** Per-character merge of two reads for display: "?" wherever they differ or either has "?". */
export function mergeDisplay(a: string, b: string): string {
  const width = Math.max(a.length, b.length);
  const pa = a.padStart(width, "?");
  const pb = b.padStart(width, "?");
  let out = "";
  for (let i = 0; i < width; i++) {
    const ca = pa[i] as string;
    const cb = pb[i] as string;
    out += ca === cb && ca !== "?" ? ca : "?";
  }
  return out;
}

function result(
  score: number,
  row: number,
  outcome: AgreementResult["outcome"],
  value: string | null,
  display: string,
): AgreementResult {
  return { score, row, outcome, autoAccept: score >= AUTO_ACCEPT, value, display };
}

export function agreement(
  a: FieldRead,
  b: FieldRead,
  zoom?: FieldRead,
  opts: AgreementOptions = {},
): AgreementResult {
  const required = opts.required ?? true;
  const checksPass = opts.checksPass ?? true;
  const norm = opts.normalise ?? ((s: string) => s.trim());
  const valid = opts.valid ?? (() => true);
  const display = mergeDisplay(a.valueText, b.valueText);

  if (!required && a.legibility === "ABSENT" && b.legibility === "ABSENT") {
    return result(0, 0, "SKIPPED", null, "");
  }
  // 1
  if (
    a.legibility === "ILLEGIBLE" ||
    b.legibility === "ILLEGIBLE" ||
    (required && (a.legibility === "ABSENT" || b.legibility === "ABSENT"))
  ) {
    return result(SCORES.illegible, 1, "PERSON", null, display);
  }
  // 2
  if (a.legibility === "OVERWRITTEN" || b.legibility === "OVERWRITTEN") {
    return result(SCORES.overwritten, 2, "PERSON", null, display);
  }
  const na = norm(a.valueText);
  const nb = norm(b.valueText);
  const same = na !== null && nb !== null && na === nb && !na.includes("?");
  // 3
  if (same && checksPass && a.legibility === "CLEAR" && b.legibility === "CLEAR") {
    return result(SCORES.clear, 3, "AUTO_ACCEPT", na, na);
  }
  // 4
  const smudged = (a.legibility === "SMUDGED" ? 1 : 0) + (b.legibility === "SMUDGED" ? 1 : 0);
  const clear = (a.legibility === "CLEAR" ? 1 : 0) + (b.legibility === "CLEAR" ? 1 : 0);
  if (same && checksPass && smudged === 1 && clear === 1) {
    return result(SCORES.oneSmudged, 4, "AUTO_ACCEPT", na, na);
  }
  // 5
  if (!zoom) return result(SCORES.zoom, 5, "ZOOM", null, display);
  // 6, 7
  const nz = zoom.legibility === "CLEAR" ? norm(zoom.valueText) : null;
  if (nz !== null && !nz.includes("?") && valid(nz) && (nz === na || nz === nb)) {
    return result(SCORES.zoomAgrees, 6, "CONFIRM_ONE_TAP", nz, display);
  }
  return result(SCORES.zoom, 7, "PERSON", null, display);
}

// ---------------------------------------------------------------- normalisers (S4.2 table)

const HONORIFICS = ["NANG", "NONG", "MRS", "MR", "MS", "GNG", "G", "MANG", "ALING"];

export const normalise = {
  /** Digits, left-padded to 4. */
  serial(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0 || digits.length > 4) return null;
    return digits.padStart(4, "0");
  },
  /** M/D/YY, MM/DD/YYYY or ISO → ISO. */
  date(raw: string): string | null {
    const s = raw.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) return s;
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (!us) return null;
    const month = Number(us[1]);
    const day = Number(us[2]);
    const yy = us[3] as string;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const t = new Date(Date.UTC(year, month - 1, day));
    if (t.getUTCMonth() !== month - 1) return null;
    return t.toISOString().slice(0, 10);
  },
  /** Upper case, "M-" + 3 digits. */
  memberNo(raw: string): string | null {
    const m = /^M\s*-?\s*(\d{1,3})$/i.exec(raw.trim());
    return m ? `M-${(m[1] as string).padStart(3, "0")}` : null;
  },
  /** Upper case, honorific and punctuation removed. */
  memberName(raw: string): string {
    const words = raw
      .toUpperCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    while (words.length > 1 && HONORIFICS.includes(words[0] as string)) words.shift();
    return words.join(" ");
  },
  plotNo(raw: string): string {
    return raw.trim().toUpperCase().replace(/\s+/g, "");
  },
  /** "{n} PP", "JUTE" or "BALDI". */
  sacks(raw: string): string | null {
    const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
    const pp = /^(\d)\s*PP$/.exec(s);
    if (pp) return `${pp[1]} PP`;
    if (s === "JUTE" || s === "BALDI") return s;
    return null;
  },
  /** Comma → dot, "kg" dropped, integer grams. */
  kgGrams(raw: string): number | null {
    const s = raw.trim().toLowerCase().replace(/kg$/, "").trim().replace(",", ".");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
    const [whole, frac = ""] = s.split(".");
    return Number(whole) * 1000 + Number(frac.padEnd(2, "0")) * 10;
  },
  /** Tenths of a percent: "6.5" → 65. */
  mcPctTenths(raw: string): number | null {
    const s = raw.trim().replace("%", "").replace(",", ".");
    if (!/^\d{1,2}(\.\d)?$/.test(s)) return null;
    const [whole, frac = "0"] = s.split(".");
    return Number(whole) * 10 + Number(frac);
  },
  /** G1/1/I → G1; G2/2/II → G2; OFF. */
  grade(raw: string): "G1" | "G2" | "OFF" | null {
    const s = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (["G1", "1", "I", "GI"].includes(s)) return "G1";
    if (["G2", "2", "II", "GII"].includes(s)) return "G2";
    if (s === "OFF") return "OFF";
    return null;
  },
  /** Trimmed, spaces collapsed, P/PHP → ₱. */
  deduction(raw: string): string {
    return raw
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\bPHP\s?(?=\d)/g, "₱")
      .replace(/\bP\s?(?=\d)/g, "₱");
  },
} as const;

export interface SeasonWindow {
  opensOn: string;
  closesOn: string;
  serialMin: number;
  serialMax: number;
}

export const validate = {
  serial(value: string, w: Pick<SeasonWindow, "serialMin" | "serialMax">): boolean {
    if (!/^\d{4}$/.test(value)) return false;
    const n = Number(value);
    return n >= w.serialMin && n <= w.serialMax;
  },
  date(iso: string, w: Pick<SeasonWindow, "opensOn" | "closesOn">): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= w.opensOn && iso <= w.closesOn;
  },
  memberNo(value: string, registry: ReadonlySet<string>): boolean {
    return /^M-\d{3}$/.test(value) && registry.has(value);
  },
  memberName(value: string, registryName: string): boolean {
    return jaroWinkler(normalise.memberName(value), normalise.memberName(registryName)) >= 0.88;
  },
  plotNo(value: string): boolean {
    return /^P-\d{3}-[A-Z]$/.test(value);
  },
  sacks(value: string): boolean {
    return /^[1-9] PP$/.test(value) || value === "JUTE" || value === "BALDI";
  },
  kgText(raw: string): boolean {
    const g = normalise.kgGrams(raw);
    return g !== null && g <= 400_000;
  },
  mcPctTenths(tenths: number): boolean {
    return tenths >= 40 && tenths <= 120;
  },
  deduction(value: string): boolean {
    return value.trim().length > 0;
  },
} as const;

/** Row checks within ±10 g: gross − tare = net and net − mc_less = payable. */
export function rowChecks(r: {
  grossG: number;
  tareG: number;
  netG: number;
  mcLessG: number;
  payableG: number;
}): {
  grossTareNet: boolean;
  netMcPayable: boolean;
} {
  return {
    grossTareNet: Math.abs(r.grossG - r.tareG - r.netG) <= 10,
    netMcPayable: Math.abs(r.netG - r.mcLessG - r.payableG) <= 10,
  };
}

/** Jaro-Winkler similarity in [0, 1] (prefix scale 0.1, up to 4 characters). */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array<boolean>(s1.length).fill(false);
  const m2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, s2.length);
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
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < s1.length && prefix < s2.length && s1[prefix] === s2[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Parses the written amount of a box-13 line: the last number, optionally prefixed ₱, P or PHP. */
export function parseWrittenCentavos(text: string): number | null {
  const matches = [...normalise.deduction(text).matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const whole = Number((last[1] as string).replaceAll(",", ""));
  const frac = Number((last[2] ?? "").padEnd(2, "0"));
  const v = whole * 100 + frac;
  return Number.isSafeInteger(v) ? v : null;
}

/**
 * By hand: a person enters as few values as possible and code derives the rest. Given any two of
 * gross, tare and net (grams), returns all three, or null when fewer than two are known.
 */
export function deriveKilos(k: { grossG?: number | null; tareG?: number | null; netG?: number | null }): {
  grossG: number;
  tareG: number;
  netG: number;
} | null {
  const { grossG = null, tareG = null, netG = null } = k;
  if (grossG !== null && tareG !== null) return { grossG, tareG, netG: grossG - tareG };
  if (grossG !== null && netG !== null) return { grossG, tareG: grossG - netG, netG };
  if (tareG !== null && netG !== null) return { grossG: tareG + netG, tareG, netG };
  return null;
}

/** Whether a typed value fits a partial read pattern such as "6?.50" ("?" matches any digit). */
export function fitsPattern(value: string, pattern: string): boolean {
  if (value.length !== pattern.length) return false;
  for (let i = 0; i < value.length; i++) {
    const p = pattern[i];
    if (p !== "?" && p !== value[i]) return false;
  }
  return true;
}
