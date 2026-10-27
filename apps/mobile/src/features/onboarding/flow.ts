/**
 * M-ON-01 first run, the pure half (S1.9, design A0). Three register routes carry four questions:
 *
 *   /onboarding/language  Cebuano, Filipino or English, each heard in the phone's own voice
 *   /onboarding/theme     "Klaro ba?": the statement at this phone's text size. The app has one theme (Adlaw, approved
 *                         plan), so the route asks the question the theme step was for: can you read it?
 *   /onboarding/pair      the treasurer's single-use QR, or its 6-digit code when the camera is denied
 *   (members only)        "Basahon o paminawon una?", stored on this phone, never inferred
 */
import type { AppRole, Lang, ScreenStateOf } from "../../_shims/contracts";
import { LANGS } from "../../_shims/contracts";

export type PairState = "idle" | "pairing" | "paired" | "expired" | "used" | "invalid" | "offline" | "error";

/** Where a phone goes once it is paired: members answer read-or-listen first, unless they already have. */
export function afterPairing(role: AppRole, listenFirst: boolean | null): "listen-choice" | "home" {
  return role === "member" && listenFirst === null ? "listen-choice" : "home";
}

/** The pairing screen's `data-state` (IC-01): the choice after pairing, then the camera, then the claim. */
export function pairScreenState(opts: {
  state: PairState;
  cameraDenied: boolean;
  listenChoice: boolean;
}): ScreenStateOf<"M-ON-01"> {
  if (opts.listenChoice) return "listen-choice";
  if (opts.state === "idle" && opts.cameraDenied) return "camera-denied";
  return opts.state;
}

/**
 * A first language for a phone that has not chosen one: the registry's language for this member when the pairing
 * says so (S1.13), else the browser's (a judge opening the QR link on their own phone), else null (keep Cebuano).
 */
export function languageFromLocale(tag: string | null | undefined): Lang | null {
  const t = (tag ?? "").toLowerCase().replace("_", "-");
  const primary = t.split("-")[0] ?? "";
  if (primary === "ceb") return "ceb";
  if (primary === "fil" || primary === "tl") return "fil";
  if (primary === "en") return "en";
  return null;
}

export function firstLanguage(
  registry: Lang | null | undefined,
  locale: string | null | undefined,
): Lang | null {
  if (registry && (LANGS as readonly string[]).includes(registry)) return registry;
  return languageFromLocale(locale);
}

/** The system text size as a whole percentage, for "Text size now: 130%". */
export function textSizePct(fontScale: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= 0) return 100;
  return Math.round(fontScale * 100);
}

/** From 1.3× the sample stacks and the statement becomes one column (S1.12 "Large text"). */
export function largeText(fontScale: number): boolean {
  return fontScale >= 1.3;
}
