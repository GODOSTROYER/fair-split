// src/routes/runs: owned by the RUNS slice (apps/api/SPLIT.md).
// The run state machine (compare-and-set on state and version), quote → invoice → funding through the
// code-built canonical invoice behind the policy lattice, kill-switch flags, the run reads, and the outbox
// tasks that move money (ensureInvoice, recordPayment, postPayoutBatch, settleBatch, processWebhook,
// computeRun) and replay the audit agent's recorded session (agentTurn, C-06).

import { agentTasks } from "../../agent/tasks.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { allow, CAN } from "../../runs/access.js";
import { setFlagHandler } from "../../runs/flags.js";
import {
  approveSend,
  EmptyBody,
  fundingCheck,
  InvoicePressResponse,
  startInvoicing,
} from "../../runs/invoice.js";
import { markPaidHandler } from "../../runs/paypal.js";
import { FlagList, flagList, LineList, lineList, RunView, runView } from "../../runs/reads.js";
import { runTasks } from "../../runs/tasks.js";

export default defineRouteFolder({
  folder: "runs",
  commands: {
    markPaid: markPaidHandler,
    setFlag: setFlagHandler,
  },
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/runs/:runSlug",
        auth: "frame_or_session",
        name: "run",
        summary:
          "A run: state and version, invoice, strip, hold and line counts, approvals (W-TR-01/05/07/08)",
        response: RunView,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading the run");
        return runView(ctx.deps, ctx.scope, ctx.params.runSlug);
      },
    );
    r.route(
      {
        method: "GET",
        path: "/v1/runs/:runSlug/lines",
        auth: "frame_or_session",
        name: "lines",
        summary: "Every member line of a run in integer cents, with its hash (W-TR-05 split review)",
        response: LineList,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readRuns, "Reading lines");
        return lineList(ctx.deps, ctx.scope, ctx.params.runSlug);
      },
    );
    r.route(
      {
        method: "GET",
        path: "/v1/flags",
        auth: "frame_or_session",
        name: "flags",
        summary: "The workspace's kill switches, read fresh (env-forced ones included)",
        response: FlagList,
      },
      async (ctx) => {
        allow(ctx.credential, CAN.readFlags, "Reading the kill switches");
        return flagList(ctx.deps, ctx.scope);
      },
    );
    r.route(
      {
        method: "POST",
        path: "/v1/runs/:runSlug/invoice",
        auth: "frame_or_session",
        name: "invoice",
        summary:
          "Quote and invoice the brand: the code-built invoice, created, sent and ruled (DRAFT/QUOTED → INVOICED)",
        request: EmptyBody,
        response: InvoicePressResponse,
        errors: ["INVALID_TRANSITION", "KILL_SWITCH_ON", "CIRCUIT_OPEN", "QUEUED", "PAYPAL_REJECTED"],
      },
      async (ctx) => startInvoicing(ctx.deps, ctx.scope, ctx.credential, ctx.params.runSlug, ctx.now()),
    );
    r.route(
      {
        method: "POST",
        path: "/v1/runs/:runSlug/invoice/approve-send",
        auth: "frame_or_session",
        name: "approveSend",
        summary: "The treasurer approves sending this run's invoice (sendNeedsTreasurer)",
        request: EmptyBody,
        response: InvoicePressResponse,
        errors: ["INVALID_TRANSITION", "KILL_SWITCH_ON", "CIRCUIT_OPEN", "QUEUED", "PAYPAL_REJECTED"],
      },
      async (ctx) => approveSend(ctx.deps, ctx.scope, ctx.credential, ctx.params.runSlug, ctx.now()),
    );
    r.route(
      {
        method: "POST",
        path: "/v1/runs/:runSlug/funding-check",
        auth: "frame_or_session",
        name: "fundingCheck",
        summary:
          "Check with PayPal: one fresh GET of the invoice; FUNDED only on PAID or MARKED_AS_PAID with 0.00 due",
        request: EmptyBody,
        response: InvoicePressResponse,
        errors: [
          "INVALID_TRANSITION",
          "KILL_SWITCH_ON",
          "CIRCUIT_OPEN",
          "QUEUED",
          "PAYPAL_REJECTED",
          "RATE_LIMITED",
        ],
      },
      async (ctx) => fundingCheck(ctx.deps, ctx.scope, ctx.credential, ctx.params.runSlug),
    );
  },
  tasks: (deps) => ({ ...runTasks(deps), ...agentTasks(deps) }),
});
