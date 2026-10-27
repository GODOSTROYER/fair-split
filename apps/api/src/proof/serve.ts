// Serving a Proof: find the run (publicly by slug, or in the credential's workspace for the export), build the
// whole bundle from the server's records, then hand each credential exactly its tier (./tier.ts).
import type { ProofBundle, Provenance } from "@fairsplit/contracts";
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
} from "./bundle.js";
import { FULL_TIER_ROLES, type ProofTier, type ProofTierName, redactBundle, tierFor } from "./tier.js";

export interface ServedProof {
  body: { bundle: ProofBundle; provenance: Provenance; redacted: boolean };
  tier: ProofTierName;
  run: ProofRun;
  built: BuiltProof;
}

type Deps = Pick<AppDeps, "db" | "env" | "credentials" | "clock">;

/** `proof` and `proofJson`: anyone may read; the credential (if any, and only in the run's workspace) widens it. */
export async function servePublicProof(
  deps: Deps,
  credential: Credential | null,
  runSlug: string,
  log?: Pick<Logger, "warn">,
): Promise<ServedProof> {
  const run = await findRunBySlug(deps.db, runSlug, deps.clock.now());
  if (!run) throw problem.notFound("No such pay run.");
  if (!proofReady(run)) notReady(run);
  const built = await buildProofBundle(deps.db, run, {
    key: ledgerKeyOf(deps),
    now: deps.clock.now(),
    ...(log ? { log } : {}),
  });
  const tier = tierFor(credential, run.workspaceId);
  return finish(run, built, tier);
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
  return finish(run, built, { tier: "full" });
}

function finish(run: ProofRun, built: BuiltProof, tier: ProofTier): ServedProof {
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
  return {
    body: { bundle, provenance: built.provenance, redacted: tier.tier !== "full" },
    tier: tier.tier,
    run,
    built,
  };
}
