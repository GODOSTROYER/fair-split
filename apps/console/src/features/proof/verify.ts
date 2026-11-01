// "Verify in your browser" (W-PF-01, S1.8, S3.12): domain's verify-core runs here, over the bundle this page was
// served, against the officer and ledger keys Fair Split publishes at /.well-known/fairsplit-keys.json. Trust
// never comes from the bundle. The verifier is code-split (S2.11: the Verify chunk is lazy, ≤45 KB) and loads
// only when a person presses Verify.
//
// The public tier withholds payout receivers (C-23), and the batch hash covers them, so plate 6 cannot be
// recomputed from a public bundle: it is either attested by the server's own run over the full record (said so
// on screen) or left for the brand's full view. A withheld receiver is never reported as a mismatch.
//
// Seeded and demo keys read "Sample", never "Verified" (contracts SAMPLE_KEY_KINDS). Like the API's own
// attestation, the page runs the verifier in demo mode and labels the outcome.

import type { ApiClient } from "@fairsplit/api-client";
import {
  type ChainVerification,
  type PlateName,
  PlateResult,
  type ProofBundle,
  type ProofTrust,
  PublishedKeys,
} from "@fairsplit/contracts";
import { z } from "zod";
import { receiversWithheld } from "./model.js";

/** The six plates, in the chain's real order (S1.8). */
export const PLATES: readonly PlateName[] = [
  "paid",
  "ratified",
  "read",
  "computed",
  "twoKeys",
  "payoutItems",
];

export const KEYS_PATH = "/.well-known/fairsplit-keys.json";
export const SERVER_VERIFICATION_PATH = "/v1/proof/:runSlug/verification";

/** Where the trust anchors came from: the API's published keys, or (mock data only) the seed's sample keys. */
export type TrustSource = "published" | "seed";

export type CheckState = "matches" | "differs" | "server" | "withheld" | "replay";

export interface PlateCheck {
  readonly state: CheckState;
  readonly reason: string | null;
}

/** "partial": five plates checked here, the sixth needs receivers this tier withholds. */
export type Verdict = "verified" | "sample" | "failed" | "partial" | "replay";

export type FailurePlace = PlateName | "chain" | "checkpoint";

export interface VerifyOutcome {
  readonly verdict: Verdict;
  readonly checks: Readonly<Record<PlateName, PlateCheck>>;
  readonly chain: ChainVerification["chain"];
  readonly checkpoint: ChainVerification["checkpoint"];
  /** Seeded or demo keys that signed: the reason a full match reads "Sample". */
  readonly sampleKeys: readonly string[];
  /** PayPal's own records of the run, to match in PayPal. */
  readonly anchors: ChainVerification["anchors"];
  readonly withheld: boolean;
  readonly trust: TrustSource;
  /** The first thing that did not hold: the chain, its signed checkpoint, or a plate. */
  readonly failure: { readonly where: FailurePlace; readonly reason: string } | null;
  /** The ledger head this outcome is about: a newer bundle makes it stale. */
  readonly head: string;
}

/** Maps verify-core's result onto the six checks the page shows, accounting for withheld receivers. */
export function outcomeOf(
  v: ChainVerification,
  ctx: {
    readonly withheld: boolean;
    readonly server: PlateResult | null;
    readonly trust: TrustSource;
    readonly head: string;
  },
): VerifyOutcome {
  const checks = {} as Record<PlateName, PlateCheck>;
  for (const plate of PLATES) {
    const result = plate === "payoutItems" && ctx.withheld ? ctx.server : v.plates[plate];
    if (result?.ok && result.state === "replay") {
      checks[plate] = { state: "replay", reason: result.reason };
      continue;
    }
    if (plate === "payoutItems" && ctx.withheld) {
      checks[plate] = ctx.server
        ? ctx.server.ok
          ? { state: "server", reason: null }
          : { state: "differs", reason: ctx.server.reason }
        : { state: "withheld", reason: null };
      continue;
    }
    checks[plate] = result?.ok
      ? { state: "matches", reason: null }
      : { state: "differs", reason: result?.reason ?? null };
  }
  let failure: VerifyOutcome["failure"] = null;
  if (!v.chain.ok) {
    failure = {
      where: "chain",
      reason:
        v.chain.brokenAtSeq !== null
          ? `The record's hash chain breaks at entry ${v.chain.brokenAtSeq}.`
          : "The record's hash chain does not hold together.",
    };
  } else if (!v.checkpoint.ok) {
    failure = {
      where: "checkpoint",
      reason: v.checkpoint.reason ?? "The ledger checkpoint does not verify.",
    };
  } else {
    const plate = PLATES.find((p) => checks[p].state === "differs");
    if (plate) failure = { where: plate, reason: checks[plate].reason ?? "This plate does not match." };
  }
  const anyWithheld = PLATES.some((p) => checks[p].state === "withheld");
  const replay = PLATES.some((p) => checks[p].state === "replay");
  const verdict: Verdict = failure
    ? "failed"
    : replay
      ? "replay"
      : anyWithheld
        ? "partial"
        : v.sampleKeys.length > 0
          ? "sample"
          : "verified";
  return {
    verdict,
    checks,
    chain: v.chain,
    checkpoint: v.checkpoint,
    sampleKeys: v.sampleKeys,
    anchors: v.anchors,
    withheld: ctx.withheld,
    trust: ctx.trust,
    failure,
    head: ctx.head,
  };
}

/** The ledger head a bundle ends in (what an outcome is about). */
export function headOf(bundle: Pick<ProofBundle, "checkpoint">): string {
  return `${bundle.checkpoint.seq}:${bundle.checkpoint.entryHash}`;
}

/** The published keys for this run, or (mock data only) the seed's sample keys when the mock publishes none. */
export async function loadPublishedKeys(
  api: Pick<ApiClient, "request">,
  runSlug: string,
  seedFallback: PublishedKeys | null,
): Promise<{ readonly trust: PublishedKeys; readonly source: TrustSource }> {
  try {
    const trust = await api.request({
      path: KEYS_PATH,
      query: { run: runSlug },
      schema: PublishedKeys,
      name: "publishedKeys",
    });
    return { trust, source: "published" };
  } catch (error) {
    if (seedFallback) return { trust: seedFallback, source: "seed" };
    throw error;
  }
}

const ServerVerification = z.looseObject({
  attestedBy: z.literal("fs-api"),
  verification: z.looseObject({ plates: z.looseObject({ payoutItems: PlateResult }) }),
});

/** The server's own run of the verifier over the full record, for plate 6 only (null when it does not answer). */
export async function loadServerPlate6(
  api: Pick<ApiClient, "request">,
  runSlug: string,
): Promise<PlateResult | null> {
  try {
    const body = await api.request({
      path: SERVER_VERIFICATION_PATH,
      params: { runSlug },
      schema: ServerVerification,
      name: "proofVerification",
    });
    return body.verification.plates.payoutItems;
  } catch {
    return null;
  }
}

type VerifyModule = typeof import("../../lib/verify.js");

export interface VerifyInput {
  readonly bundle: ProofBundle;
  readonly keys: () => Promise<{ readonly trust: PublishedKeys | ProofTrust; readonly source: TrustSource }>;
  /** Plate 6's server attestation, asked for only when this tier withholds receivers. */
  readonly server?: () => Promise<PlateResult | null>;
  /** The verifier chunk (lazy by default). */
  readonly load?: () => Promise<Pick<VerifyModule, "verifyChainWith" | "browserProofCrypto">>;
}

/** Loads the verifier and the keys, then checks the chain, its checkpoint and the six plates in this browser. */
export async function runVerification(input: VerifyInput): Promise<VerifyOutcome> {
  const withheld = receiversWithheld(input.bundle);
  const [mod, keys, server] = await Promise.all([
    (input.load ?? (() => import("../../lib/verify.js")))(),
    input.keys(),
    withheld && input.server ? input.server() : Promise.resolve(null),
  ]);
  const verification = mod.verifyChainWith(input.bundle, mod.browserProofCrypto, keys.trust, {
    demoMode: true,
  });
  return outcomeOf(verification, { withheld, server, trust: keys.source, head: headOf(input.bundle) });
}
