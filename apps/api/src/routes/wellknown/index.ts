// src/routes/wellknown: owned by the PROOF slice (apps/api/SPLIT.md).
// `/.well-known/fairsplit-keys.json` (contracts `PublishedKeys`): the trust anchors a Proof verifier pins, kept
// apart from every bundle. Officer keys (treasurer and Chair, each with its approver, role and kind) and ledger
// keys (this server's checkpoint key and the seed's sample key). Demo (`web_demo`) and seeded keys are published
// with their kind, so a Proof they sign reads "Sample", never "Verified". Never a private half.
//
//   GET /.well-known/fairsplit-keys.json              the non-judge workspaces' officers + sample and ledger keys
//   GET /.well-known/fairsplit-keys.json?run=2026A-r… one run's officers (a judge session's demo keys included)
import { PublishedKeys, RunSlug } from "@fairsplit/contracts";
import { z } from "zod";
import { ledgerKeyOf } from "../../ledger/keys.js";
import { reply } from "../../lib/command.js";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { findRunBySlug } from "../../proof/bundle.js";
import { publishedKeys } from "../../proof/keys.js";
import { takePublicRead } from "../../proof/limits.js";

export const WELL_KNOWN_KEYS_PATH = "/.well-known/fairsplit-keys.json";

const KeysQuery = z.strictObject({ run: RunSlug.optional() });

export default defineRouteFolder({
  folder: "wellknown",
  commands: {},
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: WELL_KNOWN_KEYS_PATH,
        auth: "none",
        name: "keys",
        summary: "The officer and ledger keys a Proof verifier pins (public halves only)",
        description:
          "Trust anchors for `verifyChain(bundle, keys)`, always fetched apart from the bundle. `?run=` publishes that run's officers (a judge session's labelled demo keys included); without it, the co-op's officers. Seeded and demo keys carry their kind, so what they sign reads Sample.",
        request: KeysQuery,
        response: PublishedKeys,
      },
      async (ctx) => {
        takePublicRead(ctx.c);
        let workspaceId: string | null = null;
        if (ctx.input.run) {
          const run = await findRunBySlug(ctx.deps.db, ctx.input.run, ctx.now());
          if (!run) throw problem.notFound("No such pay run.");
          workspaceId = run.workspaceId;
        }
        const keys = await publishedKeys(ctx.deps.db, ledgerKeyOf(ctx.deps), { workspaceId, log: ctx.log });
        // Public, cacheable for a minute: registrations and revocations show up quickly.
        return reply(200, keys, {
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*",
        });
      },
    );
  },
});
