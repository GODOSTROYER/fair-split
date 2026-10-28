// src/routes/statements: owned by the PROOF slice (apps/api/SPLIT.md).
// Statements (StatementPlan + a pure renderStatement for display, spoken and SMS) and the member's review request
// ("Ipasusi pag-usab").
//
//   POST /v1/review-requests                     createReviewRequest   acting   member (own line), judge, treasurer, clerk
//   GET  /v1/statements/:lineId?lang=            (slice)               the line's member link, or an acting officer
//   GET  /v1/statements/:lineId/review-requests  (slice)               same readers
//   task explain {lineId, lang}                                         records the template words a statement uses
import { Lang as ContractLang, ReviewRequestDTO } from "@fairsplit/contracts";
import { z } from "zod";
import { reply } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { readableStatement } from "../../statements/access.js";
import { explainTask } from "../../statements/explain.js";
import { createReviewRequest, listReviewRequests, ReviewOpening } from "../../statements/review.js";
import { StatementView, statementView } from "../../statements/view.js";

const StatementQuery = z.strictObject({ lang: ContractLang.optional() });

export default defineRouteFolder({
  folder: "statements",
  commands: {
    createReviewRequest: async (ctx) => {
      const reviewRequest = await createReviewRequest(
        ctx.deps.db,
        ctx.credential,
        ctx.scope,
        {
          lineId: ctx.input.lineId,
          slipSerial: ctx.input.slipSerial,
          note: ctx.input.note,
        },
        ctx.deps,
      );
      return reply(201, { reviewRequest });
    },
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/statements/:lineId",
        auth: "public",
        name: "statement",
        summary: "A member's statement: plan, display, spoken and SMS text (numbers rendered by code)",
        description:
          "Readable with the line's member link (`fsm_…`) or an acting credential in the line's workspace (the member only for their own line; the treasurer, Chair, clerk and a judge for any). `?lang=` switches language (default: the member's registry language). Lines still being checked show no amount.",
        request: StatementQuery,
        response: StatementView,
        errors: ["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN"],
      },
      async (ctx) => {
        const sc = await readableStatement(
          ctx.deps,
          ctx.credential,
          ctx.credentialProblem,
          ctx.params.lineId,
          ctx.input.lang,
        );
        return statementView(ctx.deps.db, sc);
      },
    );

    r.route(
      {
        method: "GET",
        path: "/v1/statements/:lineId/review-requests",
        auth: "public",
        name: "reviewRequests",
        summary: "A line's re-check requests (open ones show on W-TR-09 and the member's Pangutana)",
        description:
          "Same readers as the statement. Each request's `review.requested` chain entry records only `noteSha256 = sha256(salt ‖ utf8(note))`, so the public Proof's ledger never opens to a dictionary of notes; `openings` hands this line's readers each salt, to check the entry with plain sha256.",
        response: z.strictObject({
          reviewRequests: z.array(ReviewRequestDTO),
          openings: z.array(ReviewOpening),
        }),
        errors: ["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN"],
      },
      async (ctx) => {
        const sc = await readableStatement(
          ctx.deps,
          ctx.credential,
          ctx.credentialProblem,
          ctx.params.lineId,
          undefined,
        );
        return listReviewRequests(
          ctx.deps.db,
          ctx.deps.credentials,
          sc.workspaceId,
          sc.facts.lineId,
          sc.facts.memberNo,
        );
      },
    );
  },
  tasks: (deps) => ({ explain: explainTask(deps.db) }),
});
