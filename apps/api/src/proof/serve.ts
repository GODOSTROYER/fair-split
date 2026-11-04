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
import { takeProofBuild } from "./limits.js";
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

type Deps = Pick<AppDeps, "db" | "env" | "credentials" | "clock" | "rateLimits">;

// No contract/verifier checkpoint freshness bound is shorter than this. Builds never serve beyond 2 seconds,
// and every lookup checks the head before using a cached body. Bound both in-flight work and resident JSON.
const CACHE_TTL_MS = 2_000;
// Above the complete e2e session crowd (about 20). Completed LRU eviction never drops an in-flight build.
const MAX_PENDING_BUILDS = 32;
const CACHE_BYTES = 16 * 1024 * 1024;
// Tier JSON has its own byte budget: rotating receivers can evict serialized variants, never the shared build.
const VARIANT_BYTES = 16 * 1024 * 1024;
interface CachedBuild {
  retained: boolean;
  built: BuiltProof;
  verification: ChainVerification;
  metrics: ProofMetrics;
  variants: Map<string, CachedPublicProof>;
}
interface CacheEntry {
  at: number;
  bytes: number;
  pending: boolean;
  value: Promise<CachedBuild>;
  completed?: CachedBuild;
}
interface ProofCache {
  builds: Map<string, CacheEntry>;
  variants: Map<CachedPublicProof, { bytes: number; owner: CachedBuild; key: string }>;
}
const caches = new WeakMap<Deps, ProofCache>();

function dropBuild(cache: ProofCache, key: string, entry: CacheEntry): void {
  cache.builds.delete(key);
  const value = entry.completed;
  if (value) {
    value.retained = false;
    for (const variant of value.variants.values()) cache.variants.delete(variant);
    value.variants.clear();
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? String(item) : item)),
    "utf8",
  );
}

function serveTier(cache: ProofCache, value: CachedBuild, tier: ProofTier): CachedPublicProof {
  const key = JSON.stringify(tier);
  const hit = value.variants.get(key);
  if (hit) {
    const size = cache.variants.get(hit);
    if (size) {
      cache.variants.delete(hit);
      cache.variants.set(hit, size);
    }
    return hit;
  }
  const served = { ...finish(value.built, tier), verification: value.verification, metrics: value.metrics };
  if (!value.retained) return served;
  value.variants.set(key, served);
  // Count both the serialized string and the redacted object conservatively. Shared ledger data is already
  // charged to the base build, but double-counting it here keeps the resident budget on the safe side.
  cache.variants.set(served, {
    bytes: 2 * Buffer.byteLength(served.serializedBody, "utf8"),
    owner: value,
    key,
  });
  let total = [...cache.variants.values()].reduce((sum, variant) => sum + variant.bytes, 0);
  for (const [variant, size] of cache.variants) {
    if (total <= VARIANT_BYTES) break;
    total -= size.bytes;
    size.owner.variants.delete(size.key);
    cache.variants.delete(variant);
  }
  return served;
}

async function cachedPublicBuild(
  deps: Deps,
  run: ProofRun,
  tier: ProofTier,
  log?: Pick<Logger, "warn">,
  networkKey?: string,
): Promise<CachedPublicProof> {
  const [head] = await deps.db
    .select({ seq: schema.ledgerHeads.seq })
    .from(schema.ledgerHeads)
    .where(eq(schema.ledgerHeads.workspaceId, run.workspaceId))
    .limit(1);
  const now = deps.clock.nowMs();
  let state = caches.get(deps);
  if (!state) {
    state = { builds: new Map(), variants: new Map() };
    caches.set(deps, state);
  }
  const cache = state.builds;
  for (const [key, entry] of cache)
    if (!entry.pending && (now - entry.at >= CACHE_TTL_MS || now < entry.at)) dropBuild(state, key, entry);
  const key = `${run.id}|${head?.seq ?? 0}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return serveTier(state, await hit.value, tier);
  }
  if ([...cache.values()].filter((entry) => entry.pending).length >= MAX_PENDING_BUILDS) {
    throw problem.rateLimited(1_000, "Proof builds are busy. Try again shortly.");
  }
  // A read budget alone doesn't bound visitors rotating many runs/heads. Charge only actual builds,
  // after deduplication, so member tiers, exports and concurrent readers share the reservation.
  takeProofBuild(deps, networkKey);
  const entry: CacheEntry = {
    at: now,
    bytes: 0,
    pending: true,
    value: Promise.resolve(null as unknown as CachedBuild),
  };
  entry.value = (async () => {
    const served = await readSnapshot(deps.db, async (tx) => {
      const built = await buildProofBundle(tx, run, {
        key: ledgerKeyOf(deps),
        now: deps.clock.now(),
        ...(log ? { log } : {}),
      });
      const keys = await publishedKeys(tx, ledgerKeyOf(deps), {
        workspaceId: built.facts.run.workspaceId,
        ...(log ? { log } : {}),
      });
      return {
        retained: true,
        built,
        variants: new Map<string, CachedPublicProof>(),
        verification: verifyChain(built.bundle, keys, { demoMode: true }),
        metrics: await proofMetrics(tx, built.facts),
      };
    });
    entry.bytes = 2 * serializedBytes(served);
    entry.at = deps.clock.nowMs();
    entry.pending = false;
    entry.completed = served;
    let total = [...cache.values()].reduce((sum, e) => sum + e.bytes, 0);
    for (const [oldest, value] of cache) {
      if (total <= CACHE_BYTES) break;
      if (value.pending) continue;
      total -= value.bytes;
      dropBuild(state, oldest, value);
    }
    return served;
  })();
  cache.set(key, entry);
  entry.value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return serveTier(state, await entry.value, tier);
}

/** `proof` and `proofJson`: anyone may read; the credential (if any, and only in the run's workspace) widens it. */
export async function servePublicProof(
  deps: Deps,
  credential: Credential | null,
  runSlug: string,
  log?: Pick<Logger, "warn">,
  networkKey?: string,
): Promise<CachedPublicProof> {
  const run = await findRunBySlug(deps.db, runSlug, deps.clock.now());
  if (!run) throw problem.notFound("No such pay run.");
  if (!proofReady(run)) notReady(run);
  const tier = tierFor(credential, run.workspaceId);
  return cachedPublicBuild(deps, run, tier, log, networkKey);
}

/** `proofExport`: the full bundle for the brand, the treasurer, the Chair or a judge, in their own workspace. */
export async function serveProofExport(
  deps: Deps,
  credential: Extract<Credential, { kind: "frame" | "device" | "judge_session" }>,
  runSlug: string,
  log?: Pick<Logger, "warn">,
  networkKey?: string,
): Promise<ServedProof> {
  if (!FULL_TIER_ROLES.includes(credential.role)) {
    throw problem.forbidden("Only the brand, the treasurer, the Chair or a judge can export the full Proof.");
  }
  const run = await findRunInWorkspace(deps.db, credential.workspaceId, runSlug);
  if (!run) throw problem.notFound("No such pay run in this workspace.");
  if (!proofReady(run)) notReady(run);
  return cachedPublicBuild(deps, run, { tier: "full" }, log, networkKey);
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
