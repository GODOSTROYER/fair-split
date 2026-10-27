/**
 * The paired session and where each role lives (register §4 "App navigation"). Shared by the shell (state, the index
 * redirect), onboarding (pairing writes a session), and every role's screens (they read it).
 *
 * A phone becomes a session three ways: a pairing QR or 6-digit code (`device` bearer on the APK, a 2-hour `frame`
 * token on the web), a judge stage frame (IC-12 `fs.token`), or a labelled demo link (`?demo=member|board|clerk`).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
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
  /** A clerk phone's station ("Purok 2 pickup"), when the pairing names one (the clerk's chip and capture meta). */
  station?: string | null;
  /** The co-op treasurer's first name, when the pairing sends it ("Gihangyo ni Analyn…"); copy says "the treasurer" without it. */
  treasurerName?: string | null;
}

/** The demo session's bearer: it holds no secret, so it may persist in plain preferences. */
export const DEMO_BEARER = "demo-session";

/** A short, key-safe fingerprint of `parts` (JSON, so no two field lists ever run into each other). */
function fingerprint(domain: string, parts: readonly string[]): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([domain, ...parts])))).slice(0, 16);
}

/**
 * The pairing a session came from, named without its secret: a fingerprint of the workspace, the persona and when
 * this phone paired. A restored session keeps it; pairing again, even as the same person with a new token, makes a
 * new one. What belongs to one pairing only (the board's signing key, the pairing a capture was filed under) is
 * bound to it.
 */
export function pairingId(s: Pick<PairedSession, "workspaceId" | "persona" | "pairedAt">): string {
  return fingerprint("fair-split-pairing", [s.workspaceId, s.persona, s.pairedAt]);
}

/**
 * Who a session is, across pairings: a fingerprint of the workspace and the persona. What this phone keeps for a
 * person (a statement's offline copy, a re-check request) is kept under it, so a phone paired to someone else, or to
 * the same persona in another co-op or judge workspace, never reads it.
 */
export function identityKey(s: Pick<PairedSession, "workspaceId" | "persona">): string {
  return fingerprint("fair-split-identity", [s.workspaceId, s.persona]);
}

/** True when `next` is not the pairing `prev` was: the phone was paired again (as anyone), or unpaired. */
export function pairingChanged(
  prev: Pick<PairedSession, "workspaceId" | "persona" | "pairedAt"> | null,
  next: Pick<PairedSession, "workspaceId" | "persona" | "pairedAt"> | null,
): boolean {
  if (!prev) return false;
  return !next || pairingId(prev) !== pairingId(next);
}

/** A session is usable until it expires; frame tokens last 2 hours, device tokens longer. */
export function sessionValid(s: Pick<PairedSession, "expiresAt"> | null, now: Date): boolean {
  if (!s) return false;
  const t = Date.parse(s.expiresAt);
  return Number.isFinite(t) && t > now.getTime();
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
    const station = textOrNull(s.station);
    const treasurerName = textOrNull(s.treasurerName);
    if (station) session.station = station;
    if (treasurerName) session.treasurerName = treasurerName;
    return sessionValid(session, now) ? session : null;
  } catch {
    return null;
  }
}

/**
 * Where a session is kept on this phone, as JSON: a device bearer only in the secure store, the demo session (it holds
 * no secret) in plain preferences, a frame token nowhere (memory, for the tab's life). Whatever is null is cleared,
 * so a phone keeps one stored pairing at most and an earlier one is never restored in place of the latest.
 */
export function sessionStores(s: PairedSession | null): { secret: string | null; plain: string | null } {
  if (!s) return { secret: null, plain: null };
  if (s.bearer === DEMO_BEARER) return { secret: null, plain: JSON.stringify(s) };
  if (s.kind === "device") return { secret: JSON.stringify(s), plain: null };
  return { secret: null, plain: null };
}

/**
 * The session a phone restores at start: its device pairing when one is stored (none once it has expired or is
 * unreadable: the phone pairs again), else the demo session. A device pairing that lapsed never brings back an older
 * session stored beside it by an earlier build.
 */
export function restoreSession(secret: string | null, plain: string | null, now: Date): PairedSession | null {
  if (secret) return parseSession(secret, now);
  return parseSession(plain, now);
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

/**
 * Flags a visit keeps when the index sends it to the role's home (`/app/?demo=member&stage=sent&motion=reduced` →
 * `/app/bayad?demo=member&stage=sent&motion=reduced`), so a reload, a shared address or a screen that reads its flag
 * after the redirect still sees it. Only these display and demo flags travel: never a token (`t`) or anything else.
 */
export const CARRIED_FLAGS = ["demo", "stage", "line", "motion", "tier", "theme", "fsTrace"] as const;

export function carriedFlags(search: string): Record<string, string> {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const k of CARRIED_FLAGS) {
    const v = q.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/** `href` with the carried flags as its query; a route's own params win over a flag of the same name. */
export function withFlags(href: Href, flags: Readonly<Record<string, string>>): Href {
  if (Object.keys(flags).length === 0) return href;
  if (typeof href === "string") return { pathname: href, params: { ...flags } } as Href;
  return { ...href, params: { ...flags, ...(href.params ?? {}) } } as Href;
}

/**
 * Demo data only: the workspace a judge frame works in after its `n`-th reset. Each reset is a fresh demo workspace,
 * so what the last judge filed (the clerk's outbox keeps one database per workspace) never reappears for the next.
 * A live fs-api names its own workspaces and is never rewritten.
 */
export function demoWorkspaceAfterReset(workspaceId: string, resets: number): string {
  return resets > 0 ? `${workspaceId}~r${resets}` : workspaceId;
}
