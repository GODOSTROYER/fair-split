/**
 * Pairing (M-ON-01, register §4): a single-use QR (10 minutes) or, when the camera is denied, its 6-digit code
 * binds this phone to a role and workspace. The QR carries `/app/pair?t=…` (register), and S3's fragment form
 * `#t=…` and the native scheme `fairsplit://pair?t=…` are accepted too. The same module guards the other way into
 * the app from outside, a tapped notification (`pushRoute`): only the app's own routes, never an address.
 */

import type { ApiResult, PairClaimRequest, PairClaimResponse } from "../_shims/api-client";
import type { ApiErrorCode } from "../_shims/contracts";
import { RUN_SLUG_RE } from "../_shims/contracts";
import type { PairedSession } from "../services/session";

/** The pairing code is six digits; anything else typed or pasted is dropped as the person types. */
export const CODE_LENGTH = 6;

/** Keeps the digits of what was typed or pasted ("418 207", "418-207"), at most six. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** "418207" → "418 207": how the treasurer's screen prints it, so the two can be compared by eye. */
export function displayCode(code: string): string {
  const d = normalizeCode(code);
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

const LEAVES = new Set(["bayad", "resibo", "pangutana", "paminawa", "scan", "outbox", "pirma"]);

/**
 * The in-app route a notification may open (architecture §8: a co-sign request or the statement), or null. Only
 * the register's routes pass, a run slug must look like one (`2026A-r37`), and anything with a scheme, a host,
 * `..`, a backslash, a query or a fragment is refused: a push can never send the phone to an outside address.
 */
export function pushRoute(data: unknown): string | null {
  const url =
    typeof data === "string"
      ? data
      : data && typeof data === "object" && typeof (data as { url?: unknown }).url === "string"
        ? (data as { url: string }).url
        : null;
  if (!url || url.length > 200 || !url.startsWith("/") || url.startsWith("//")) return null;
  if (/[\\?#:%\s]|\.\./.test(url)) return null;
  // Route groups are part of the file path, not the URL: "/(board)/pirma/2026A-r37" is "/pirma/2026A-r37".
  const parts = url
    .split("/")
    .slice(1)
    .filter((p) => !/^\([a-z]+\)$/.test(p));
  const [leaf, slug, sub, ...rest] = parts;
  if (!leaf || !LEAVES.has(leaf) || rest.length > 0) return null;
  if (leaf !== "pirma") return slug === undefined ? `/${leaf}` : null;
  if (slug === undefined) return "/pirma";
  if (!RUN_SLUG_RE.test(slug)) return null;
  if (sub === undefined) return `/pirma/${slug}`;
  return sub === "sign" ? `/pirma/${slug}/sign` : null;
}

export type { PairedSession } from "../services/session";

export type PairingInput =
  | { kind: "token"; token: string }
  | { kind: "code"; code: string }
  | { kind: "invalid"; reason: "empty" | "not-fair-split" | "bad-token" | "bad-code" };

/** Tokens are opaque base64url; bound the length so a hostile QR cannot push megabytes into a request. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;
const CODE_RE = /^\d{6}$/;

function tokenFrom(params: string): string | null {
  for (const part of params.replace(/^[?#]/, "").split("&")) {
    const [k, v = ""] = part.split("=");
    if (k === "t") {
      try {
        return decodeURIComponent(v);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parsePairingInput(raw: string): PairingInput {
  const text = raw.trim();
  if (!text) return { kind: "invalid", reason: "empty" };

  const digits = text.replace(/[\s-]/g, "");
  if (/^\d+$/.test(digits)) {
    return CODE_RE.test(digits) ? { kind: "code", code: digits } : { kind: "invalid", reason: "bad-code" };
  }

  let path: string;
  let query = "";
  let fragment = "";
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(text);
  if (m) {
    const scheme = (m[1] ?? "").toLowerCase();
    const host = m[2] ?? "";
    if (scheme === "fairsplit")
      path = `/${host}${m[3] ?? ""}`; // fairsplit://pair?t=…
    else if (scheme === "https" || scheme === "http") path = m[3] ?? "";
    else return { kind: "invalid", reason: "not-fair-split" };
    query = m[4] ?? "";
    fragment = m[5] ?? "";
  } else if (text.startsWith("/")) {
    const q = text.indexOf("?");
    const h = text.indexOf("#");
    const end = Math.min(q < 0 ? text.length : q, h < 0 ? text.length : h);
    path = text.slice(0, end);
    query = q >= 0 ? text.slice(q, h > q ? h : undefined) : "";
    fragment = h >= 0 ? text.slice(h) : "";
  } else {
    return TOKEN_RE.test(text)
      ? { kind: "token", token: text }
      : { kind: "invalid", reason: "not-fair-split" };
  }

  const normalised = path.replace(/\/+$/, "");
  if (!/(^|\/)pair$/.test(normalised)) return { kind: "invalid", reason: "not-fair-split" };
  const token = tokenFrom(query) ?? tokenFrom(fragment);
  if (!token || !TOKEN_RE.test(token)) return { kind: "invalid", reason: "bad-token" };
  return { kind: "token", token };
}

export type PairingOutcome =
  | { ok: true; session: PairedSession }
  | { ok: false; state: "expired" | "used" | "invalid" | "offline" | "error"; code: ApiErrorCode | "INPUT" };

const STATE_FOR: Partial<Record<ApiErrorCode, "expired" | "used" | "invalid" | "offline">> = {
  PAIRING_EXPIRED: "expired",
  PAIRING_USED: "used",
  PAIRING_INVALID: "invalid",
  NETWORK: "offline",
};

export interface ClaimDeps {
  claim: (req: PairClaimRequest) => Promise<ApiResult<PairClaimResponse>>;
  device: PairClaimRequest["device"];
  now: () => Date;
}

/** Redeems a parsed QR or code. The server enforces single use and the 10-minute window. */
export async function claimPairing(input: PairingInput, deps: ClaimDeps): Promise<PairingOutcome> {
  if (input.kind === "invalid") return { ok: false, state: "invalid", code: "INPUT" };
  const req: PairClaimRequest =
    input.kind === "token"
      ? { token: input.token, device: deps.device }
      : { code6: input.code, device: deps.device };
  const r = await deps.claim(req);
  if (!r.ok) return { ok: false, state: STATE_FOR[r.code] ?? "error", code: r.code };
  const v = r.value;
  if (!v.bearer || !v.role || !["member", "clerk", "board"].includes(v.role)) {
    return { ok: false, state: "error", code: "PAIRING_INVALID" };
  }
  return {
    ok: true,
    session: {
      kind: v.kind,
      bearer: v.bearer,
      expiresAt: v.expiresAt,
      workspaceId: v.workspaceId,
      persona: v.persona,
      role: v.role,
      memberNo: v.memberNo ?? null,
      displayName: v.displayName,
      lang: v.lang ?? null,
      pairedAt: deps.now().toISOString(),
    },
  };
}
