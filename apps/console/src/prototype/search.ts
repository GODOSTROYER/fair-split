// URL state for the prototype, so every view is linkable for sign-off and for Playwright:
// /prototype/moments/MM-5?t=1600&motion=reduced&theme=adlaw

export type ThemeChoice = "tablea" | "adlaw";
export type MotionChoice = "system" | "full" | "reduced" | "low";
export type LangChoice = "ceb" | "fil" | "en";

export interface PrototypeSearch {
  readonly theme?: ThemeChoice;
  readonly motion?: MotionChoice;
  readonly lang?: LangChoice;
  readonly t?: number;
  readonly study?: string;
  /** Seal sheet: the size every seal is drawn at. */
  readonly px?: SheetSize;
  /** Seal sheet: the seal being inspected, 1 to SHEET_COUNT, so a flag is a link. */
  readonly seal?: number;
}

/** The seal sheet's sizes (S2 §2.12) and how many seeded digests it draws. */
export const SHEET_SIZES = [64, 200, 320] as const;
export type SheetSize = (typeof SHEET_SIZES)[number];
export const SHEET_COUNT = 300;

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

export function parseSearch(input: Record<string, unknown>): PrototypeSearch {
  const t = typeof input.t === "number" ? input.t : typeof input.t === "string" ? Number(input.t) : undefined;
  const out: { -readonly [K in keyof PrototypeSearch]: PrototypeSearch[K] } = {};
  const theme = pick(input.theme, ["tablea", "adlaw"] as const);
  const motion = pick(input.motion, ["system", "full", "reduced", "low"] as const);
  const lang = pick(input.lang, ["ceb", "fil", "en"] as const);
  if (theme) out.theme = theme;
  if (motion) out.motion = motion;
  if (lang) out.lang = lang;
  if (t !== undefined && Number.isFinite(t) && t >= 0) out.t = Math.round(t);
  if (typeof input.study === "string" && /^[A-Za-z0-9-]{1,32}$/.test(input.study)) out.study = input.study;
  const px = Number(input.px);
  if ((SHEET_SIZES as readonly number[]).includes(px)) out.px = px as SheetSize;
  const sealNo = Number(input.seal);
  if (Number.isInteger(sealNo) && sealNo >= 1 && sealNo <= SHEET_COUNT) out.seal = sealNo;
  return out;
}

export const COMPOSITIONS = [
  { id: "judge-stage", screen: "W-JG-01", title: "Judge stage", note: "First view, before the first press" },
  {
    id: "split-review",
    screen: "W-TR-05 + W-TR-06",
    title: "Split review, hold H1",
    note: "Drawer open on H1",
  },
  { id: "approve-ready", screen: "W-TR-07", title: "Approve, ready", note: "Every blocking hold resolved" },
  { id: "approve-key-1", screen: "W-TR-07", title: "Approve, key 1 signed", note: "Waiting for Ernesto" },
  {
    id: "statement",
    screen: "M-MB-01",
    title: "Statement, sent and paid",
    note: "Nang Celing, in a phone frame",
  },
  { id: "proof", screen: "W-PF-01", title: "Proof", note: "Checked in the browser, public, light only" },
] as const;

export type CompositionId = (typeof COMPOSITIONS)[number]["id"];

export const STUDY_MOMENTS = [
  { id: "MM-5", title: "Two keys", screens: "W-TR-07 and M-BD-02" },
  { id: "MM-1", title: "Bayad na", screens: "M-MB-01" },
] as const;

export type StudyMomentId = (typeof STUDY_MOMENTS)[number]["id"];
