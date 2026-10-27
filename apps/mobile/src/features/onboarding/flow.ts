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

/**
 * Whether a code the camera reads should be claimed. The camera reports the QR in front of it many times a second,
 * and a refused claim leaves that same QR in view: a code is claimed once, a repeat of the last one is ignored, and
 * after a refusal nothing is sent again until a different code is read or the person taps "Scan again" (which
 * forgets `last`). Nothing is claimed while a claim is in flight or once the phone is paired.
 */
export function shouldClaimScan(last: string | null, next: string, state: PairState): boolean {
  if (state === "pairing" || state === "paired") return false;
  return next.trim().length > 0 && next !== last;
}

/** A refused scan the person can retry with the same code ("Scan again"): every claim state except success. */
export function scanRefused(state: PairState): boolean {
  return (
    state === "expired" || state === "used" || state === "invalid" || state === "offline" || state === "error"
  );
}

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

/**
 * A season or lot mark as stencilled on the jute sacks (design §1, signature 7): each character, and whether a
 * bridge cuts it. Only glyphs with a closed counter need a bridge to hold together as a stencil.
 */
const BRIDGED = new Set("04689ABDOPQR");

export function stencilGlyphs(text: string): { id: string; char: string; bridged: boolean }[] {
  return [...text.toUpperCase()].map((char, i) => ({ id: `${i}${char}`, char, bridged: BRIDGED.has(char) }));
}

/** The QR facsimile's grid: 25 cells a side, with a 7-cell finder square (and its 1-cell margin) in three corners. */
export const QR_CELLS = 25;

function inFinderZone(r: number, c: number): boolean {
  const near = (v: number) => v < 8;
  const far = (v: number) => v > QR_CELLS - 9;
  return (near(r) && near(c)) || (near(r) && far(c)) || (far(r) && near(c));
}

/**
 * The facsimile QR's modules on the pairing card: a fixed scatter (the same on every phone and every render) clear of
 * the finder corners. It only has to look like the treasurer's QR; it encodes nothing.
 */
export function qrFacsimileCells(seed = 0x2026a): [number, number][] {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 16;
  };
  const cells: [number, number][] = [];
  for (let r = 0; r < QR_CELLS; r++) {
    for (let c = 0; c < QR_CELLS; c++) {
      if (!inFinderZone(r, c) && next() % 100 < 46) cells.push([r, c]);
    }
  }
  return cells;
}

/** The initials an ink stamp carries: first and last name ("Ernesto P. Cabahug" → "EC"), never a middle initial. */
export function stampInitials(name: string): string {
  const parts = name.split(/\s+/).filter((p) => /^[A-Za-zÑñ]/.test(p) && !p.endsWith("."));
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
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
