// Resolve a signed link in memory before its ledger revocation lookup, so refused reads use no DB slot.
import { bearerToken, isLinkToken, verifyLink } from "../credentials/verify/index.js";
import { clientIpKey } from "./client-ip.js";
import type { AppContext } from "./context.js";
import { problem } from "./problem.js";
import type { RateRule } from "./rate-limit.js";

export const LINK_READ_RULES = {
  link: { name: "linkRead", limit: 60, windowMs: 60_000 },
  network: { name: "linkReadNetwork", limit: 300, windowMs: 60_000 },
} as const satisfies Record<string, RateRule>;

/** Shared by command routes and custom media/Proof handlers through credentialResult. */
export function takeLinkRead(c: AppContext): void {
  if (
    c.req.method !== "GET" ||
    !/^\/v1\/(?:credential$|statements\/[^/]+(?:\/review-requests)?$|review-requests$|media\/audio\/[^/]+$|proof(?:\/|$))/.test(
      c.req.path,
    )
  )
    return;
  const token = bearerToken(c.req.header("authorization"));
  if (!token || !isLinkToken(token)) return;
  const deps = c.get("deps");
  const verified = verifyLink(deps.credentials.keys.linkPublicKeyHex, token, deps.clock.nowMs());
  if (!verified.ok) return;
  const decision = deps.rateLimits.takeAll([
    [LINK_READ_RULES.link, `link:${verified.payload.ws}:${verified.payload.jti}`],
    [LINK_READ_RULES.network, clientIpKey(c)],
  ]);
  if (!decision.ok) throw problem.rateLimited(decision.retryAfterMs, "Too many link reads. Retry shortly.");
}
