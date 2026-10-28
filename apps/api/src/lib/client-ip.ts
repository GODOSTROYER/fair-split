// The client's address, for per-IP throttles and quotas only (S3.9). A forwarding header is a claim made by
// whoever sent it, so fs-api believes exactly one hop: the one FS_TRUSTED_EDGE (env.ts) says it sits behind.
//
//   none        nothing in front (the default off Render): the socket's peer; every forwarding header is ignored
//   proxy       one reverse proxy that appends the address it saw to X-Forwarded-For: the rightmost entry
//   cloudflare  Cloudflare's edge directly in front: CF-Connecting-IP, which the edge sets on every request and
//               overwrites when a client sends one
//   render      the default on Render (RENDER=true): Cloudflare's edge in front of Render's proxy (S3.9).
//               CF-Connecting-IP, else the rightmost X-Forwarded-For entry (the address Render's proxy saw, e.g.
//               a request that did not cross the edge), else the peer (a private-network caller such as fs-cron)
//
// True-Client-IP is never read. Cloudflare adds it only on Enterprise zones that turn its managed transform on,
// and otherwise passes on whatever the client wrote; where the edge does add it, it equals CF-Connecting-IP. S3.9
// names it first on the premise that the edge sets both (unverified, S6): reading CF-Connecting-IP gives the same
// address whenever that premise holds and refuses a forged one when it does not. The leftmost X-Forwarded-For
// entries are the client's own claims and are never read either. A value that is not an IP address counts as
// absent, so the next (more trusted) source answers. The address itself is never stored or logged: throttles
// key on `hashedClientIp` (an HMAC with a daily salt).
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { Context } from "hono";
import type { CredentialKeys } from "../credentials/verify/keys.js";
import type { TrustedEdge } from "../env.js";
import type { AppContext } from "./context.js";

type HeaderGetter = { get(name: string): string | null };

/** The client address under `edge`, from the request's headers and the socket's peer address (pure). */
export function resolveClientIp(
  edge: TrustedEdge,
  headers: HeaderGetter,
  peer: string | null,
): string | null {
  const socket = bare(peer);
  switch (edge) {
    case "none":
      return socket;
    case "proxy":
      return rightmostForwarded(headers) ?? socket;
    case "cloudflare":
      return bare(headers.get("cf-connecting-ip")) ?? socket;
    case "render":
      return bare(headers.get("cf-connecting-ip")) ?? rightmostForwarded(headers) ?? socket;
  }
}

/** The socket's peer address (the Node server's bindings: `serve()` → `app.fetch(req, { incoming })`). */
export function peerAddress(c: Context): string | null {
  const bindings = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined;
  const address = bindings?.incoming?.socket?.remoteAddress;
  return typeof address === "string" ? address : null;
}

/** This request's client address by the deployment's trust rule; null when unknown (in-process requests). */
export function clientIp(c: AppContext): string | null {
  return resolveClientIp(c.get("deps").env.trustedEdge, c.req.raw.headers, peerAddress(c));
}

/** "We hash your IP address for one day to rate-limit visits. We don't store it." */
export function hashedClientIp(keys: CredentialKeys, ip: string | null, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", keys.hmacKey("ip-hash"))
    .update(`${ip ?? "unknown"}|${day}`)
    .digest("hex")
    .slice(0, 32);
}

/** The hashed client address of this request: the key every per-IP throttle takes. */
export function clientIpKey(c: AppContext): string {
  const deps = c.get("deps");
  return hashedClientIp(deps.credentials.keys, clientIp(c), deps.clock.now());
}

/** The entry the nearest proxy appended (multiple header lines arrive joined, the last one last). */
function rightmostForwarded(headers: HeaderGetter): string | null {
  const entries = (headers.get("x-forwarded-for") ?? "").split(",");
  return bare(entries[entries.length - 1] ?? null);
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
