// Wire formats of every credential (S3.8). One definition for both directions, so the judge slice's issuer
// (src/credentials/issue) and this verifier can never disagree on bytes:
//
//   opaque bearer   fst_<43 base64url>  frame / console token (frame_tokens.token_sha256 = sha256 hex of the string)
//                   fsd_<43 base64url>  app device token from a pairing claim (same table)
//   signed cookie   <b64url(JSON payload)>.<b64url(HMAC-SHA256(subkey, payloadB64))>   fs_js (judge), fs_ops (operator)
//   signed link     fsm_<b64url(JCS payload)>.<b64url(Ed25519 sig)>   member link, `/s/:token`
//                   fsb_<b64url(JCS payload)>.<b64url(Ed25519 sig)>   brand link, `/b/:token`
//
// Tokens never travel in URLs except the two links, which are links by design (sent with no-referrer).
import { createHash, createHmac, type KeyObject, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519Sign, ed25519Verify, jcs } from "@fairsplit/domain";
import { z } from "zod";

// ---------------------------------------------------------------- lifetimes (S3.8)

export const FRAME_TOKEN_TTL_MS = 2 * 60 * 60_000;
export const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
export const PAIRING_TTL_MS = 10 * 60_000;
export const JUDGE_COOKIE_TTL_MS = 24 * 60 * 60_000;
export const OPERATOR_COOKIE_TTL_MS = 8 * 60 * 60_000;
export const LINK_TTL_MS = 30 * 24 * 60 * 60_000;

// ---------------------------------------------------------------- opaque bearer tokens

export const OPAQUE_PREFIX = { frame: "fst_", device: "fsd_" } as const;
export type OpaqueKind = keyof typeof OPAQUE_PREFIX;
const OPAQUE_RE = /^(fst|fsd)_[A-Za-z0-9_-]{43}$/;

/** A fresh 256-bit bearer token. Return it to the client once; store only `opaqueTokenSha256(token)`. */
export function generateOpaqueToken(kind: OpaqueKind): string {
  return `${OPAQUE_PREFIX[kind]}${randomBytes(32).toString("base64url")}`;
}

export function parseOpaqueToken(token: string): { kind: OpaqueKind } | null {
  const m = OPAQUE_RE.exec(token);
  if (!m) return null;
  return { kind: m[1] === "fst" ? "frame" : "device" };
}

/** The value stored in `frame_tokens.token_sha256` (lowercase hex). */
export function opaqueTokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ---------------------------------------------------------------- signed cookies

const epochSeconds = z.int().positive();

export const JudgeCookiePayload = z.strictObject({
  v: z.literal(1),
  /** judge session id (uuid) */
  sid: z.uuid(),
  /** the workspace the session claimed (uuid) */
  ws: z.uuid(),
  iat: epochSeconds,
  exp: epochSeconds,
});
export type JudgeCookiePayload = z.infer<typeof JudgeCookiePayload>;

export const OperatorCookiePayload = z.strictObject({
  v: z.literal(1),
  sub: z.literal("operator"),
  iat: epochSeconds,
  exp: epochSeconds,
});
export type OperatorCookiePayload = z.infer<typeof OperatorCookiePayload>;

export const JUDGE_COOKIE = { name: "fs_js", purpose: "cookie:fs_js", ttlMs: JUDGE_COOKIE_TTL_MS } as const;
export const OPERATOR_COOKIE = {
  name: "fs_ops",
  purpose: "cookie:fs_ops",
  ttlMs: OPERATOR_COOKIE_TTL_MS,
} as const;

/** Cookie attributes for both cookies: HttpOnly, SameSite=Lax, Secure on https origins, whole-site path. */
export function cookieAttributes(publicOrigin: string, maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: publicOrigin.startsWith("https://"),
    sameSite: "Lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export function signCookie(key: Buffer, payload: JudgeCookiePayload | OperatorCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(key, body)}`;
}

export type VerifyFailure = "malformed" | "bad_signature" | "expired";
export type Verified<T> = { ok: true; payload: T } | { ok: false; reason: VerifyFailure };

export function verifyCookie<T extends z.ZodType>(
  schema: T,
  key: Buffer,
  value: string | undefined,
  nowMs: number,
): Verified<z.output<T>> {
  if (!value || value.length > 1024) return { ok: false, reason: "malformed" };
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!safeEqual(mac, hmac(key, body))) return { ok: false, reason: "bad_signature" };
  const parsed = schema.safeParse(parseJson(Buffer.from(body, "base64url").toString("utf8")));
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const payload = parsed.data as { exp: number };
  if (payload.exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, payload: parsed.data };
}

// ---------------------------------------------------------------- signed links (Ed25519)

export const MemberLinkPayload = z.strictObject({
  v: z.literal(1),
  k: z.literal("member"),
  ws: z.uuid(),
  lineId: z.uuid(),
  /** unique id: rotates on reprint, revocable */
  jti: z.string().min(8).max(64),
  exp: epochSeconds,
});
export type MemberLinkPayload = z.infer<typeof MemberLinkPayload>;

export const BrandLinkPayload = z.strictObject({
  v: z.literal(1),
  k: z.literal("brand"),
  ws: z.uuid(),
  brand: z.string().min(1).max(64),
  jti: z.string().min(8).max(64),
  exp: epochSeconds,
});
export type BrandLinkPayload = z.infer<typeof BrandLinkPayload>;

export type LinkPayload = MemberLinkPayload | BrandLinkPayload;
const LINK_PREFIX = { member: "fsm_", brand: "fsb_" } as const;
const LINK_RE = /^(fsm|fsb)_([A-Za-z0-9_-]{16,1024})\.([A-Za-z0-9_-]{86})$/;

/** Signs a link payload with the FS_LINK_SIGNING_KEY private half (issuer side). */
export function signLink(privateKey: KeyObject, payload: LinkPayload): string {
  const body = Buffer.from(jcs(payload), "utf8").toString("base64url");
  const sig = Buffer.from(ed25519Sign(privateKey, body), "hex").toString("base64url");
  return `${LINK_PREFIX[payload.k]}${body}.${sig}`;
}

export function isLinkToken(token: string): boolean {
  return LINK_RE.test(token);
}

export function verifyLink(publicKeyHex: string, token: string, nowMs: number): Verified<LinkPayload> {
  const m = LINK_RE.exec(token);
  if (!m) return { ok: false, reason: "malformed" };
  const [, prefix, body, sig] = m as unknown as [string, "fsm" | "fsb", string, string];
  const sigHex = Buffer.from(sig, "base64url").toString("hex");
  if (!ed25519Verify(publicKeyHex, body, sigHex)) return { ok: false, reason: "bad_signature" };
  const schema = prefix === "fsm" ? MemberLinkPayload : BrandLinkPayload;
  const parsed = schema.safeParse(parseJson(Buffer.from(body, "base64url").toString("utf8")));
  if (!parsed.success) return { ok: false, reason: "malformed" };
  if (parsed.data.exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, payload: parsed.data };
}

// ---------------------------------------------------------------- helpers

/** `Authorization: Bearer <token>` → the token, or null (any other scheme, or none). */
export function bearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer[ ]+([^\s]{1,2048})$/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

function hmac(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
