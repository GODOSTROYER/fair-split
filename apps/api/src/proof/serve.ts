// Serving a Proof: find the run (publicly by slug, or in the credential's workspace for the export), build the
// whole bundle from the server's records, then hand each credential exactly its tier (./tier.ts).
import type { ChainVerification, ProofBundle, Provenance } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { verifyChain } from "@fairsplit/domain";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { Credential } from "../credentials/verify/index.js";
import { ledgerKeyOf } from "../ledger/keys.js";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import {
  type BuiltProof,
  buildProofBundle,
  findRunBySlug,
  findRunInWorkspace,
  notReady,
  type ProofRun,
  proofReady,
  readSnapshot,
} from "./bundle.js";
import { publishedKeys } from "./keys.js";
import { type ProofMetrics, proofMetrics } from "./metrics.js";
import { FULL_TIER_ROLES, type ProofTier, type ProofTierName, redactBundle, tierFor } from "./tier.js";

export interface ServedProof {
  body: { bundle: ProofBundle; provenance: Provenance; redacted: boolean };
  tier: ProofTierName;
  run: ProofRun;
  built: BuiltProof;
  serializedBody: string;
  verification?: ChainVerification;
}

interface CachedPublicProof extends ServedProof {
  verification: ChainVerification;
  metrics: ProofMetrics;
}

type Deps = Pick<AppDeps, "db" | "env" | "credentials" | "clock">;

// No contract/verifier checkpoint freshness bound is shorter than this. Builds never serve beyond 2 seconds,
// and every lookup checks the head before using a cached body. Bound both in-flight work and resident JSON.
const CACHE_TTL_MS = 2_000;
const CACHE_ENTRIES = 4;
// Above the complete e2e session crowd (about 20). Completed LRU eviction never drops an in-flight build.
const MAX_PENDING_BUILDS = 32;
const CACHE_BYTES = 16 * 1024 * 1024;
interface CacheEntry {
  at: number;
  bytes: number;
  pending: boolean;
  value: Promise<CachedPublicProof>;
}
const caches = new WeakMap<Deps, Map<string, CacheEntry>>();

async function cachedPublicBuild(
  deps: Deps,
  run: ProofRun,
  tier: ProofTier,
  log?: Pick<Logger, "warn">,
): Promise<CachedPublicProof> {
  const [head] = await deps.db
    .select({ seq: schema.ledgerHeads.seq })
    .from(schema.ledgerHeads)
    .where(eq(schema.ledgerHeads.workspaceId, run.workspaceId))
    .limit(1);
  const now = deps.clock.nowMs();
  let cache = caches.get(deps);
  if (!cache) {
    cache = new Map();
    caches.set(deps, cache);
  }
  for (const [key, entry] of cache)
    if (!entry.pending && (now - entry.at >= CACHE_TTL_MS || now < entry.at)) cache.delete(key);
  const key = `${run.id}|${head?.seq ?? 0}|${JSON.stringify(tier)}`;
  const hit = cache.get(key);
  if (hit) return hit.value;
  if ([...cache.values()].filter((entry) => entry.pending).length >= MAX_PENDING_BUILDS) {
    throw problem.rateLimited(1_000, "Proof builds are busy. Try again shortly.");
  }
  const entry: CacheEntry = {
    at: now,
    bytes: 0,
    pending: true,
    value: Promise.resolve(null as unknown as CachedPublicProof),
  };
  entry.value = (async () => {
    const served = await readSnapshot(deps.db, async (tx) => {
      const built = await buildProofBundle(tx, run, {
        key: ledgerKeyOf(deps),
        now: deps.clock.now(),
        ...(log ? { log } : {}),
      });
      const result = finish(built, tier);
      const keys = await publishedKeys(tx, ledgerKeyOf(deps), {
        workspaceId: result.run.workspaceId,
        ...(log ? { log } : {}),
      });
      return {
        ...result,
        verification: verifyChain(built.bundle, keys, { demoMode: true }),
        metrics: await proofMetrics(tx, built.facts),
      };
    });
    entry.bytes = Buffer.byteLength(served.serializedBody, "utf8");
    entry.pending = false;
    let total = [...cache.values()].reduce((sum, e) => sum + e.bytes, 0);
    let completed = [...cache.values()].filter((e) => !e.pending).length;
    for (const [oldest, value] of cache) {
      if (total <= CACHE_BYTES && completed <= CACHE_ENTRIES) break;
      if (value.pending) continue;
      total -= value.bytes;
      completed--;
      cache.delete(oldest);
    }
    return served;
  })();
  cache.set(key, entry);
  entry.value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return entry.value;
}

/** `proof` and `proofJson`: anyone may read; the credential (if any, and only in the run's workspace) widens it. */
export async function servePublicProof(
  deps: Deps,
  credential: Credential | null,
  runSlug: string,
  log?: Pick<Logger, "warn">,
): Promise<CachedPublicProof> {
  const run = await findRunBySlug(deps.db, runSlug, deps.clock.now());
  if (!run) throw problem.notFound("No such pay run.");
  if (!proofReady(run)) notReady(run);
  const tier = tierFor(credential, run.workspaceId);
  return cachedPublicBuild(deps, run, tier, log);
}

/** `proofExport`: the full bundle for the brand, the treasurer, the Chair or a judge, in their own workspace. */
export async function serveProofExport(
  deps: Deps,
  credential: Extract<Credential, { kind: "frame" | "device" | "judge_session" }>,
  runSlug: string,
  log?: Pick<Logger, "warn">,
): Promise<ServedProof> {
  if (!FULL_TIER_ROLES.includes(credential.role)) {
    throw problem.forbidden("Only the brand, the treasurer, the Chair or a judge can export the full Proof.");
  }
  const run = await findRunInWorkspace(deps.db, credential.workspaceId, runSlug);
  if (!run) throw problem.notFound("No such pay run in this workspace.");
  if (!proofReady(run)) notReady(run);
  const built = await buildProofBundle(deps.db, run, {
    key: ledgerKeyOf(deps),
    now: deps.clock.now(),
    ...(log ? { log } : {}),
  });
  return finish(built, { tier: "full" });
}

function finish(built: BuiltProof, tier: ProofTier): ServedProof {
  // the run as the bundle's own snapshot read it (never the lookup that preceded it)
  const run: ProofRun = built.facts.run;
  let own: string | null = null;
  if (tier.tier === "member") {
    const line = built.facts.lines.find(
      (l) =>
        (tier.lineId !== null && l.lineId.toLowerCase() === tier.lineId.toLowerCase()) ||
        (tier.memberId !== null && l.memberId.toLowerCase() === tier.memberId.toLowerCase()),
    );
    own = line?.memberNo ?? null;
  }
  const bundle = redactBundle(built.bundle, tier.tier, own);
  const body = { bundle, provenance: built.provenance, redacted: tier.tier !== "full" };
  return {
    body,
    serializedBody: JSON.stringify(body),
    tier: tier.tier,
    run,
    built,
  };
}
