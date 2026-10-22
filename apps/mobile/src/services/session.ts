/**
 * The paired session and where each role lives (register §4 "App navigation"). Shared by the shell (state, the index
 * redirect), onboarding (pairing writes a session), and every role's screens (they read it).
 *
 * A phone becomes a session three ways: a pairing QR or 6-digit code (`device` bearer on the APK, a 2-hour `frame`
 * token on the web), a judge stage frame (IC-12 `fs.token`), or a labelled demo link (`?demo=member|board|clerk`).
 */
import type { Href } from "expo-router";
import type { AppRole, Lang } from "../_shims/contracts";

export interface PairedSession {
  kind: "device" | "frame";
  /** Bearer token: device tokens live only in SecureStore; frame tokens only in memory. Never in a URL. */
  bearer: string;
  expiresAt: string;
  workspaceId: string;
  /** `member:M-014`, `board:ernesto` or `clerk:jessie`. */
  persona: string;
  role: AppRole;
  memberNo: string | null;
  displayName: string;
  /** The registry's language for this member, if the server sent one. */
  lang: Lang | null;
  pairedAt: string;
}

/** The demo session's bearer: it holds no secret, so it may persist in plain preferences. */
export const DEMO_BEARER = "demo-session";

/** A session is usable until it expires; frame tokens last 2 hours, device tokens longer. */
export function sessionValid(s: Pick<PairedSession, "expiresAt"> | null, now: Date): boolean {
  if (!s) return false;
  const t = Date.parse(s.expiresAt);
  return Number.isFinite(t) && t > now.getTime();
}

/** Parses a persisted session; anything malformed is the same as none (pair again). */
export function parseSession(raw: string | null, now: Date): PairedSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<PairedSession>;
    const roleOk = s.role === "member" || s.role === "clerk" || s.role === "board";
    const kindOk = s.kind === "device" || s.kind === "frame";
    if (!roleOk || !kindOk || typeof s.bearer !== "string" || typeof s.workspaceId !== "string") return null;
    if (typeof s.persona !== "string" || typeof s.expiresAt !== "string") return null;
    const session: PairedSession = {
      kind: s.kind as PairedSession["kind"],
      bearer: s.bearer,
      expiresAt: s.expiresAt,
      workspaceId: s.workspaceId,
      persona: s.persona,
      role: s.role as AppRole,
      memberNo: typeof s.memberNo === "string" ? s.memberNo : null,
      displayName: typeof s.displayName === "string" ? s.displayName : "",
      lang: s.lang === "ceb" || s.lang === "fil" || s.lang === "en" ? s.lang : null,
      pairedAt: typeof s.pairedAt === "string" ? s.pairedAt : now.toISOString(),
    };
    return sessionValid(session, now) ? session : null;
  } catch {
    return null;
  }
}

/**
 * Typed hrefs for every app route (the file paths under src/app). Register §4 writes the member routes as
 * `/(member)/bayad`; the tabs sit in a nested `(tabs)` group so Paminawa can be a modal over them, and the URL is the
 * register's either way (`/app/bayad`).
 */
export const HREF = {
  language: "/onboarding/language",
  theme: "/onboarding/theme",
  pair: "/onboarding/pair",
  bayad: "/(member)/(tabs)/bayad",
  resibo: "/(member)/(tabs)/resibo",
  pangutana: "/(member)/(tabs)/pangutana",
  paminawa: "/(member)/paminawa",
  scan: "/(clerk)/scan",
  outbox: "/(clerk)/outbox",
  boardBayad: "/(board)/bayad",
  boardPangutana: "/(board)/pangutana",
  pirmaHome: "/(board)/pirma",
} as const satisfies Record<string, Href>;

export function pirmaHref(runSlug: string): Href {
  return { pathname: "/(board)/pirma/[runSlug]", params: { runSlug } };
}

export function signHref(runSlug: string): Href {
  return { pathname: "/(board)/pirma/[runSlug]/sign", params: { runSlug } };
}

/** Where a paired phone lands: the member's statement, the clerk's scanner, or the board's open co-sign request. */
export function homeHref(role: AppRole, runSlug: string | null): Href {
  if (role === "member") return HREF.bayad;
  if (role === "clerk") return HREF.scan;
  return runSlug ? pirmaHref(runSlug) : HREF.pirmaHome;
}
