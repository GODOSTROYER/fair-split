// src/routes/print: owned by the PROOF slice (apps/api/SPLIT.md).
// 80 mm print data for a member's line (W-TR-09): exact pesos for cash lines, the ReceiptBar, slips, the
// rate-card hash, the black seal, a QR to the member's signed link and the "Nadawat" box.
//
//   GET /v1/print/:runSlug/members/:memberNo?lang=   acting: the treasurer, the clerk, the Chair or a judge
import { Lang, MemberNo } from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { findRunInWorkspace } from "../../proof/bundle.js";
import { loadStatementContext } from "../../statements/facts.js";
import { PrintSlip, printSlip } from "../../statements/print.js";

/** Who prints statements at the bodega (and a judge acting as them). */
const PRINT_ROLES = new Set(["treasurer", "clerk", "board", "judge"]);

async function lineOf(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
  memberNo: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.memberLines.id })
    .from(schema.memberLines)
    .innerJoin(
      schema.members,
      and(
        eq(schema.members.workspaceId, schema.memberLines.workspaceId),
        eq(schema.members.id, schema.memberLines.memberId),
      ),
    )
    .where(
      and(
        eq(schema.memberLines.workspaceId, workspaceId),
        eq(schema.memberLines.runId, runId),
        eq(schema.members.memberNo, memberNo),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export default defineRouteFolder({
  folder: "print",
  commands: {},
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/print/:runSlug/members/:memberNo",
        auth: "frame_or_session",
        name: "memberPrint",
        summary: "80 mm print data for one member's line",
        description:
          "What the thermal print carries (W-TR-09): exact pesos at the run's recorded rate for cash lines, the rate line, the ReceiptBar, slips, the rate-card hash, the batch seal, a QR to a freshly signed member link (a reprint rotates it) and the Nadawat box. `?lang=` (default: the member's registry language).",
        params: { memberNo: MemberNo },
        request: z.strictObject({ lang: Lang.optional() }),
        response: PrintSlip,
      },
      async (ctx) => {
        if (!PRINT_ROLES.has(ctx.credential.role)) {
          throw problem.forbidden("Statements are printed by the treasurer or the clerk.");
        }
        const run = await findRunInWorkspace(ctx.deps.db, ctx.scope.workspaceId, ctx.params.runSlug);
        if (!run) throw problem.notFound("No such pay run in this workspace.");
        const lineId = await lineOf(ctx.deps.db, ctx.scope.workspaceId, run.id, ctx.params.memberNo);
        if (!lineId) throw problem.notFound(`No line for ${ctx.params.memberNo} in this run.`);
        const sc = await loadStatementContext(ctx.deps.db, ctx.scope.workspaceId, lineId, ctx.input.lang);
        if (!sc) throw problem.notFound("No such line in this workspace.");
        return printSlip(ctx.deps, ctx.deps.db, sc);
      },
    );
  },
});
