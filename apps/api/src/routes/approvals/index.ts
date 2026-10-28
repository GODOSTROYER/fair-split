// src/routes/approvals: owned by the RUNS slice (apps/api/SPLIT.md).
// Two keys: the payload is built by code from the database batch; a signature is verified against the
// `device_keys` registry with distinct keys and approvers, a used-nonce store and exp within 30 minutes.
// `/batch` serves the items the payload signs, so M-BD-01 recomputes batchSha256 and draws the seal itself.
import {
  approvalPayloadHandler,
  batchView,
  declineApprovalHandler,
  submitApprovalHandler,
} from "../../approvals/handlers.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { allow, CAN } from "../../runs/access.js";
import { ApprovalList, approvalList, BatchView } from "../../runs/reads.js";

export default defineRouteFolder({
  folder: "approvals",
  commands: {
    approvalPayload: approvalPayloadHandler,
    submitApproval: submitApprovalHandler,
    declineApproval: declineApprovalHandler,
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/runs/:runSlug/batch",
        auth: "frame_or_session",
        name: "batch",
        summary: "The batch both keys sign: items, sender_batch_id, batchSha256 and who must co-sign (R5)",
        response: BatchView,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading the batch");
        return batchView(ctx.deps, ctx.scope, ctx.params.runSlug);
      },
    );
    r.route(
      {
        method: "GET",
        path: "/v1/runs/:runSlug/approvals",
        auth: "frame_or_session",
        name: "approvals",
        summary: "The run's signed approvals, voided ones included",
        response: ApprovalList,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading approvals");
        return approvalList(ctx.deps, ctx.scope, ctx.params.runSlug);
      },
    );
  },
});
