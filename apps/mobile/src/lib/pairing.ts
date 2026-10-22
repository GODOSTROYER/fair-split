/**
 * Pairing (M-ON-01, register §4): a single-use QR (10 minutes) or, when the camera is denied, its 6-digit code
 * binds this phone to a role and workspace. The QR carries `/app/pair?t=…` (register), and S3's fragment form
 * `#t=…` and the native scheme `fairsplit://pair?t=…` are accepted too.
 */

import type { ApiResult, PairClaimRequest, PairClaimResponse } from "../_shims/api-client";
import type { ApiErrorCode } from "../_shims/contracts";
import type { PairedSession } from "../services/session";

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
