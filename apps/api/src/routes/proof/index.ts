// src/routes/proof: owned by the PROOF slice (apps/api/SPLIT.md).
// The Proof bundle (six plates; member IDs only, C-23), tiered by credential (public, member link, brand), its
// aggregate metrics, the server's own verification of the full bundle, and the public aggregate SSE stream.
//
//   GET /v1/proof/:runSlug                proof         public   bundle, tier by credential (X-FS-Proof-Tier)
//   GET /v1/proof/:runSlug.json           proofJson     public   the same bundle as a download
//   GET /v1/proof/:runSlug/export         proofExport   acting   the full bundle (brand, treasurer, Chair, judge)
//   GET /v1/proof/:runSlug/metrics        (slice)       public   the Proof page's metrics, aggregates only
//   GET /v1/proof/:runSlug/verification   (slice)       public   this server's verification of the FULL bundle
//   GET /v1/proof/:runSlug/events         (slice, SSE)  public   aggregate progress ("3 of 8 confirmed")
import { ChainVerification, Provenance, RunSlug } from "@fairsplit/contracts";
import { verifyChain } from "@fairsplit/domain";
import { z } from "zod";
import { ledgerKeyOf } from "../../ledger/keys.js";
import { type CommandContext, reply } from "../../lib/command.js";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { findRunBySlug, loadProofFacts, notReady, proofReady, readSnapshot } from "../../proof/bundle.js";
import { publishedKeys } from "../../proof/keys.js";
import { takePublicRead } from "../../proof/limits.js";
import { ProofMetrics, proofMetrics } from "../../proof/metrics.js";
import { serveProofExport, servePublicProof } from "../../proof/serve.js";
import { mountProofStream } from "../../proof/stream.js";

const TIER_HEADER = "X-FS-Proof-Tier";

async function publicProof(ctx: CommandContext<"proof"> | CommandContext<"proofJson">, download: boolean) {
  takePublicRead(ctx.c);
  const served = await servePublicProof(ctx.deps, ctx.credential, ctx.params.runSlug, ctx.log);
  const headers: Record<string, string> = { [TIER_HEADER]: served.tier };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="FS-${served.run.runSlug}.proof.json"`;
  }
  return reply(200, served.body, headers);
}

const ProofVerificationResponse = z.strictObject({
  runSlug: RunSlug,
  provenance: Provenance,
  /** What this server attests: its own run of the verifier over the FULL bundle (receivers included). */
  attestedBy: z.literal("fs-api"),
  /** Demo mode is on: seeded and demo keys read "sample", never "verified". */
  demoMode: z.literal(true),
  verification: ChainVerification,
});

export default defineRouteFolder({
  folder: "proof",
  commands: {
    proof: (ctx) => publicProof(ctx, false),
    proofJson: (ctx) => publicProof(ctx, true),
    proofExport: async (ctx) => {
      const served = await serveProofExport(ctx.deps, ctx.credential, ctx.params.runSlug, ctx.log);
      return reply(200, served.body, {
        [TIER_HEADER]: served.tier,
        "Content-Disposition": `attachment; filename="FS-${served.run.runSlug}.proof.full.json"`,
      });
    },
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/proof/:runSlug/metrics",
        auth: "public",
        name: "metrics",
        summary: "The Proof page's metrics (aggregates only, never a name or receiver)",
        description:
          "Lines explained, premium allocated, paid in three tiers (PayPal-verified, cash attested, due), holds caught and kept for members, PayPal against cash. Every figure is computed by code from the server's records, with its display string.",
        response: ProofMetrics,
      },
      async (ctx) => {
        takePublicRead(ctx.c);
        const run = await findRunBySlug(ctx.deps.db, ctx.params.runSlug, ctx.now());
        if (!run) throw problem.notFound("No such pay run.");
        if (!proofReady(run)) notReady(run);
        return readSnapshot(ctx.deps.db, async (tx) => proofMetrics(tx, await loadProofFacts(tx, run)));
      },
    );

    r.route(
      {
        method: "GET",
        path: "/v1/proof/:runSlug/verification",
        auth: "public",
        name: "verification",
        summary: "This server's verification of the full bundle (labelled: attested by fs-api)",
        description:
          "The public tier withholds payout receivers (C-23), so a browser cannot recompute plate 6's batch hash from it. This is the same verifier run here over the full bundle, against the keys this server publishes: an attestation by the server, never a substitute for checking plate 1 in PayPal.",
        response: ProofVerificationResponse,
      },
      async (ctx) => {
        takePublicRead(ctx.c);
        const served = await servePublicProof(ctx.deps, null, ctx.params.runSlug, ctx.log);
        const keys = await publishedKeys(ctx.deps.db, ledgerKeyOf(ctx.deps), {
          workspaceId: served.run.workspaceId,
          log: ctx.log,
        });
        return {
          runSlug: served.run.runSlug,
          provenance: served.built.provenance,
          attestedBy: "fs-api" as const,
          demoMode: true as const,
          verification: verifyChain(served.built.bundle, keys, { demoMode: true }),
        };
      },
    );

    mountProofStream(r.app);
  },
});
