// src/routes/brand: owned by the PROOF slice (apps/api/SPLIT.md).
// The brand view: names, masked receivers, CSV export (C-23: the only place names, full receivers and plot
// coordinates appear, under the data-sharing agreement).
//
//   GET /v1/brand/:runSlug              the brand's link (`fsb_…`), or the brand persona / treasurer / Chair / judge
//   GET /v1/brand/:runSlug/export.csv   the same readers; text/csv download
import { RunSlug } from "@fairsplit/contracts";
import { toHonoPath } from "../../lib/command.js";
import type { AppContext } from "../../lib/context.js";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { credentialResult } from "../../middleware/credential.js";
import { BrandView, brandCsv, brandRun, brandView } from "../../proof/brand.js";

export const BRAND_EXPORT_PATH = "/v1/brand/:runSlug/export.csv";

export default defineRouteFolder({
  folder: "brand",
  commands: {},
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/brand/:runSlug",
        auth: "public",
        name: "view",
        summary: "The brand's view of a run: names and masked receivers, totals and hashes",
        description:
          "Readable with the brand's signed link (`Authorization: Bearer fsb_…`) or by the brand persona, the treasurer, the Chair or a judge in the run's workspace. Receivers are masked here (C-23); the CSV export carries them in full.",
        response: BrandView,
        errors: ["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN"],
      },
      async (ctx) => {
        const run = await brandRun(
          ctx.deps.db,
          ctx.credential,
          ctx.credentialProblem,
          ctx.params.runSlug,
          ctx.now(),
        );
        return brandView(ctx.deps.db, run);
      },
    );

    r.app.get(toHonoPath(BRAND_EXPORT_PATH), async (c) => {
      const ctx = c as AppContext;
      const runSlug = c.req.param("runSlug") ?? "";
      if (!RunSlug.safeParse(runSlug).success) throw problem.notFound("No such pay run.");
      const resolved = await credentialResult(ctx);
      const credential = resolved.kind === "ok" ? resolved.credential : null;
      const credentialProblem = resolved.kind === "invalid" ? resolved.problem : null;
      const deps = ctx.get("deps");
      const run = await brandRun(deps.db, credential, credentialProblem, runSlug, deps.clock.now());
      const csv = await brandCsv(deps.db, run);
      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="FS-${run.runSlug}.brand.csv"`,
        "Cache-Control": "no-store",
      });
    });
  },
});
