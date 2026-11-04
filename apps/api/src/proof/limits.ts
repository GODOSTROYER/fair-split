// Request-level limits of the PROOF slice (in-process, like the shell's RATE_RULES; never PayPal's budget).
// Anonymous Proof reads build and sign a whole bundle, so each hashed IP gets a generous but finite budget; a
// member's re-check requests are bounded per line so nobody can flood the ledger with them.
import { clientIpKey } from "../lib/client-ip.js";
import type { AppContext, AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import type { RateRule } from "../lib/rate-limit.js";

export const PROOF_RATE_RULES = {
  /** Public Proof reads (bundle, JSON, metrics, verification, keys) per hashed IP. */
  publicRead: { name: "proofPublicRead", limit: 120, windowMs: 60_000 },
  exportRead: { name: "proofExportRead", limit: 120, windowMs: 60_000 },
  buildNetwork: { name: "proofBuildNetwork", limit: 60, windowMs: 60_000 },
  buildGlobal: { name: "proofBuildGlobal", limit: 120, windowMs: 60_000 },
  /** New re-check requests per member line (an identical open request is returned, not counted). */
  reviewRequest: { name: "reviewRequest", limit: 6, windowMs: 3_600_000 },
} as const satisfies Record<string, RateRule>;

/** Export downloads have a separate network budget, leaving the public page's budget available. */
export function takeExportRead(c: AppContext): void {
  const d = c.get("deps").rateLimits.take(PROOF_RATE_RULES.exportRead, clientIpKey(c));
  if (!d.ok)
    throw problem.rateLimited(d.retryAfterMs, "Too many Proof exports from here. Try again shortly.");
}

/** Only cache misses spend CPU reservations. Defaults exceed a classroom's simultaneous Proofs. */
export function takeProofBuild(deps: Pick<AppDeps, "rateLimits">, networkKey?: string): void {
  const d = deps.rateLimits.takeAll([
    [PROOF_RATE_RULES.buildGlobal, "all"],
    ...(networkKey ? [[PROOF_RATE_RULES.buildNetwork, networkKey] as const] : []),
  ]);
  if (!d.ok) throw problem.rateLimited(d.retryAfterMs, "Proof builds are busy. Try again shortly.");
}

/** Takes one public-read slot for the caller's hashed IP, or throws 429 RATE_LIMITED with Retry-After. */
export function takePublicRead(c: AppContext): void {
  const deps = c.get("deps");
  const ip = clientIpKey(c);
  const d = deps.rateLimits.take(PROOF_RATE_RULES.publicRead, ip);
  if (!d.ok)
    throw problem.rateLimited(d.retryAfterMs, "Too many Proof requests from here. Try again shortly.");
}

/** Takes one re-check slot for a line, or throws 429 RATE_LIMITED. */
export function takeReviewRequest(
  deps: Pick<AppDeps, "rateLimits">,
  workspaceId: string,
  lineId: string,
): void {
  const d = deps.rateLimits.take(PROOF_RATE_RULES.reviewRequest, `${workspaceId}:${lineId}`);
  if (!d.ok) {
    throw problem.rateLimited(
      d.retryAfterMs,
      "This line already has several re-check requests. The committee has them.",
    );
  }
}
