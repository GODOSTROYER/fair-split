// The client's address for quotas (S3.9): `true-client-ip`, else `cf-connecting-ip` (both set by the edge in
// front of Render), else the rightmost `X-Forwarded-For` entry (Render appends the address it saw; the
// leftmost entries are whatever the client sent). It is only ever stored HMAC'd with a daily salt.
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { CredentialKeys } from "../credentials/verify/keys.js";

type HeaderGetter = { get(name: string): string | null };

export function clientIp(headers: HeaderGetter, socketAddress?: string | null): string | null {
  for (const name of ["true-client-ip", "cf-connecting-ip"]) {
    const v = bare(headers.get(name));
    if (v) return v;
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const entries = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = bare(entries[entries.length - 1] ?? null);
    if (last) return last;
  }
  return bare(socketAddress ?? null);
}

/** "We hash your IP address for one day to rate-limit visits. We don't store it." */
export function hashedClientIp(keys: CredentialKeys, ip: string | null, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", keys.hmacKey("ip-hash"))
    .update(`${ip ?? "unknown"}|${day}`)
    .digest("hex")
    .slice(0, 32);
}

function bare(value: string | null): string | null {
  if (!value) return null;
  let v = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed?.[1]) v = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) !== 0 ? v : null;
}
