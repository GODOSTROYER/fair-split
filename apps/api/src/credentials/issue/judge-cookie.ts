// The judge cookie `fs_js` (S3.8, S3.9): HttpOnly, SameSite=Lax, Secure on https, HMAC-signed with the
// `cookie:fs_js` subkey, 24 h. It names the judge session (`sid`) and the workspace it claimed (`ws`).
//
// The session id outlives a Reset: a Reset ends the workspace, and the next press binds the same `sid` to a
// fresh workspace. So "per cookie" quotas (3 session starts an hour, 3 live posts a day) follow the judge's
// browser, while every workspace still dies on schedule.
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext, AppDeps } from "../../lib/context.js";
import {
  cookieAttributes,
  JUDGE_COOKIE,
  JudgeCookiePayload,
  signCookie,
  verifyCookie,
} from "../verify/index.js";

export type JudgeCookieRead =
  /** No `fs_js` cookie. */
  | { status: "absent" }
  /** Malformed, forged or past its own 24 h: start afresh with a new session id. */
  | { status: "invalid" | "expired" }
  /** A cookie this server signed; its workspace may or may not still be alive. */
  | { status: "ok"; sid: string; ws: string; iat: number; exp: number };

/** Reads and verifies the raw `fs_js` cookie (the workspace is NOT checked here). */
export function readJudgeCookie(c: AppContext, deps: AppDeps): JudgeCookieRead {
  const value = getCookie(c, JUDGE_COOKIE.name);
  if (value === undefined) return { status: "absent" };
  const v = verifyCookie(
    JudgeCookiePayload,
    deps.credentials.keys.hmacKey(JUDGE_COOKIE.purpose),
    value,
    deps.clock.nowMs(),
  );
  if (!v.ok) return { status: v.reason === "expired" ? "expired" : "invalid" };
  return { status: "ok", ...v.payload };
}

/** The signed `fs_js` value for a session bound to a workspace until `expiresAt`. */
export function judgeCookieValue(
  deps: AppDeps,
  o: { sessionId: string; workspaceId: string; now: Date; expiresAt: Date },
): string {
  return signCookie(deps.credentials.keys.hmacKey(JUDGE_COOKIE.purpose), {
    v: 1,
    sid: o.sessionId,
    ws: o.workspaceId,
    iat: Math.floor(o.now.getTime() / 1000),
    exp: Math.floor(o.expiresAt.getTime() / 1000),
  });
}

/** Sets `fs_js` on the response (HttpOnly, SameSite=Lax, Secure on https, Path=/). */
export function setJudgeCookie(
  c: AppContext,
  deps: AppDeps,
  o: { sessionId: string; workspaceId: string; now: Date; expiresAt: Date },
): void {
  const maxAgeMs = Math.max(1000, o.expiresAt.getTime() - o.now.getTime());
  setCookie(
    c,
    JUDGE_COOKIE.name,
    judgeCookieValue(deps, o),
    cookieAttributes(deps.env.publicOrigin, Math.min(maxAgeMs, JUDGE_COOKIE.ttlMs)),
  );
}
