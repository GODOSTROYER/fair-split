// `Content-Digest` (RFC 9530): `sha-256=:<base64>:` over the exact request body bytes. The clerk app sends it
// with every capture so a body corrupted on a bad connection is refused (422 CONTENT_DIGEST_MISMATCH)
// instead of stored.
import { createHash } from "node:crypto";

/** The sha-256 member of a Content-Digest header, as raw bytes; null if absent or malformed. */
export function parseContentDigest(header: string | undefined | null): Buffer | null {
  if (!header) return null;
  for (const member of header.split(",")) {
    const m = /^\s*sha-256\s*=\s*:([A-Za-z0-9+/]+={0,2}):\s*$/i.exec(member);
    if (m?.[1]) {
      const bytes = Buffer.from(m[1], "base64");
      return bytes.length === 32 ? bytes : null;
    }
  }
  return null;
}

/** `sha-256=:…:` for a body (what clients send; the api-client computes it with WebCrypto). */
export function contentDigestOf(body: string | Uint8Array): string {
  return `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
}

export function sha256Hex(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export function digestMatches(header: string | undefined | null, body: string | Uint8Array): boolean {
  const want = parseContentDigest(header);
  if (!want) return false;
  return createHash("sha256").update(body).digest().equals(want);
}
