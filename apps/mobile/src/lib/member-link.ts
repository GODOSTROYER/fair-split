/**
 * The member's link (register §4): `/s/:token` redirects to `/app/s/:token`, an Ed25519-signed, read-only view of one
 * line, valid 30 days. The server signs `{lineId, exp}` with STATEMENT_SIGNING_KEY and verifies it when the app asks
 * for the statement; the phone only reads the claims to explain an expired or broken link without a round trip.
 *
 * Token shape (shim-defined until WS-API fixes it): `base64url(JCS{lineId, exp}) "." base64url(signature)`. A `~` is
 * read as the separator too: static hosts that treat a dot in the last path segment as a file extension (and answer
 * 404 for `/app/s/abc.def`) can be given the dot-free form; both characters lie outside the base64url alphabet. The
 * dot-free form is only a spelling of the link: fs-api is always handed the token as it signed it (`token`, with
 * the dot), so a server that verifies `body.sig` never sees a `~`.
 */

export type MemberLinkCheck =
  | {
      ok: true;
      lineId: string;
      exp: string;
      /** The token as fs-api signed it, `body.sig`, whichever separator the link was written with. */
      token: string;
    }
  | { ok: false; reason: "malformed" | "expired" };

const B64URL = /^[A-Za-z0-9_-]+$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decodeBase64Url(s: string): Uint8Array | null {
  if (!B64URL.test(s)) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    buffer = (buffer << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function readMemberLink(token: string, now: Date): MemberLinkCheck {
  if (token.length > 2048) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(/[.~]/);
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const bytes = decodeBase64Url(body);
  const sigBytes = decodeBase64Url(sig);
  if (!bytes || !sigBytes || sigBytes.length !== 64) return { ok: false, reason: "malformed" };
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, reason: "malformed" };
  const { lineId, exp } = claims as Record<string, unknown>;
  if (typeof lineId !== "string" || !lineId || typeof exp !== "string")
    return { ok: false, reason: "malformed" };
  const t = Date.parse(exp);
  if (Number.isNaN(t)) return { ok: false, reason: "malformed" };
  if (t <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, lineId, exp, token: `${body}.${sig}` };
}
