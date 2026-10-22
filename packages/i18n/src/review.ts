// OD-2: every Cebuano and Filipino string ships marked "machine-translated, pending native review" until a
// native speaker signs it off before filming. Judge Mode shows the chip while any key is pending.

import { ceb } from "./catalog/ceb.js";
import type { MessageKey } from "./catalog/en.js";
import { fil } from "./catalog/fil.js";

export type ReviewedLang = "ceb" | "fil";
export type ReviewStatus = "pending-native-review" | "signed-off";

export const MACHINE_TRANSLATED_LABEL = "Machine-translated, pending native review";

export interface SignOff {
  readonly reviewer: string;
  readonly date: string;
}

/**
 * Native-speaker sign-offs, keyed `lang:key`. Empty on purpose: nothing has been reviewed yet (decision due
 * 5 Nov). Add an entry only with the reviewer's name and the date they signed.
 */
export const SIGN_OFFS: Readonly<Partial<Record<`${ReviewedLang}:${MessageKey}`, SignOff>>> = {};

export interface ReviewEntry {
  readonly lang: ReviewedLang;
  readonly key: MessageKey;
  readonly text: string;
  readonly status: ReviewStatus;
  readonly signOff?: SignOff;
}

const REVIEWED: Readonly<Record<ReviewedLang, Readonly<Record<string, string>>>> = { ceb, fil };

export function reviewStatus(lang: ReviewedLang, key: MessageKey): ReviewStatus {
  return SIGN_OFFS[`${lang}:${key}`] ? "signed-off" : "pending-native-review";
}

export function reviewEntries(): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  for (const lang of ["ceb", "fil"] as const) {
    for (const [key, text] of Object.entries(REVIEWED[lang])) {
      const k = key as MessageKey;
      const signOff = SIGN_OFFS[`${lang}:${k}`];
      out.push({ lang, key: k, text, status: reviewStatus(lang, k), ...(signOff ? { signOff } : {}) });
    }
  }
  return out;
}

/** True while any string in the language still needs a native speaker: show the chip. */
export function needsReviewChip(lang: "ceb" | "fil" | "en"): boolean {
  if (lang === "en") return false;
  return reviewEntries().some((e) => e.lang === lang && e.status === "pending-native-review");
}
