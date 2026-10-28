// src/routes/holds: owned by the RUNS slice (apps/api/SPLIT.md).
// Hold resolution (H1–H3, by hand, the mass-balance dial) with the engine's recompute in the same transaction.
import { defineRouteFolder } from "../../lib/slice.js";
import { allow, CAN } from "../../runs/access.js";
import { resolveHoldHandler } from "../../runs/holds.js";
import { HoldList, holdList } from "../../runs/reads.js";

export default defineRouteFolder({
  folder: "holds",
  commands: {
    resolveHold: resolveHoldHandler,
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/runs/:runSlug/holds",
        auth: "frame_or_session",
        name: "holds",
        summary:
          "Every hold of a run in raise order, with its engine line and Claude's pencil line (W-TR-05/06)",
        response: HoldList,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading holds");
        return holdList(ctx.deps, ctx.scope, ctx.params.runSlug);
      },
    );
  },
});
