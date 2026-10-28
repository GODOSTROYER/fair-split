// Agent session replay (C-06). Judge Mode never calls the model: it replays the recorded session step by step.
// Prose goes to the Machine lane as `agent.delta` (labelled with the recording's date); each recorded tool call
// is decided again by the LIVE policy lattice on this workspace's own data and, if allowed, executed through
// the AgentMoneyPort (PayPal runs live on the replayed inputs). Read tools are recomputed here, never read
// from the recording. A refusal, a PayPal failure or a recording that no longer fits ("replay diverged")
// stops the replay, and the remaining invoice steps hand over to the checkpointed ensureInvoice chain.
// Every replayed block is appended to `agent_sessions` (append-only) under a new session id.
import { randomUUID } from "node:crypto";
import { type AgentToolName, READ_TOOLS } from "@fairsplit/contracts";
import { schema, type WorkspaceScope, withWorkspaceTx } from "@fairsplit/db";
import type { AppDeps } from "../lib/context.js";
import { ensureInvoiceSent, quoteRun, type SendApproval } from "../money/funding.js";
import { decideAndRecord, invoiceWorld, policyContext, todayOf } from "../money/policy.js";
import { emit } from "../runs/events.js";
import { runById } from "../runs/load.js";
import { agentActor, createAgentMoneyPort } from "./executor.js";
import { type AgentSession, type ItemLabels, type PortResult, PURPOSE_LIMITS } from "./port.js";
import type { AgentRecording, RecordedStep } from "./recording.js";

type Deps = Pick<AppDeps, "db" | "env" | "paypal" | "clock" | "logger">;

export interface ReplayOutcome {
  sessionId: string;
  steps: number;
  /** Where the replay stopped early, and why (null when every step ran). */
  stoppedAt: { step: number; tool: string; reason: string } | null;
  /** The run state after the replay (and the hand-over, for the invoice turn). */
  runState: string;
}

const READS = new Set<string>(READ_TOOLS);

/** The code-written Machine-lane line for a tool call (never the model's words, S4.4). */
export function toolLine(tool: AgentToolName, ok: boolean | null): string {
  const verb: Partial<Record<AgentToolName, string>> = {
    get_invoice_quote: "Claude checked the quote",
    get_rate_card: "Claude read the ratified rate card",
    get_run_summary: "Claude read the run summary",
    list_holds: "Claude listed the holds",
    create_invoice: "Claude drafted Lantern Bay's invoice",
    send_invoice: "Claude asked to send the invoice",
    create_conditional_rules_for_invoice: "Claude asked for the auto-cancel rule",
    get_invoice: "Claude read the invoice",
    request_payout_batch: "Claude asked the treasurer to sign the batch",
    propose_resolution: "Claude proposed a resolution",
  };
  const base = verb[tool] ?? `Claude called ${tool}`;
  return ok === null ? base : ok ? `${base}: allowed` : `${base}: refused`;
}

function labelsOf(input: Record<string, unknown>): ItemLabels | null {
  const l = input.item_labels as Partial<ItemLabels> | undefined;
  return l &&
    typeof l.premium === "string" &&
    typeof l.bonus === "string" &&
    typeof l.disbursement === "string"
    ? { premium: l.premium, bonus: l.bonus, disbursement: l.disbursement }
    : null;
}

export async function replaySession(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  recording: AgentRecording,
  o: { sendApproval: SendApproval | null },
): Promise<ReplayOutcome> {
  const sessionId = randomUUID();
  const limits = PURPOSE_LIMITS[recording.purpose];
  const session: AgentSession = {
    sessionId,
    purpose: recording.purpose,
    mode: "replay",
    spentMicros: 0,
    capMicros: limits.capMicros,
    iteration: 0,
    maxIterations: Math.max(limits.maxIterations, recording.steps.length),
  };
  const port = createAgentMoneyPort(deps, scope, { session, sendApproval: o.sendApproval });
  const actor = agentActor(session);
  let seq = 0;
  const label = `Replay, recorded ${recording.recordedOn}${recording.provenance === "seed_synthetic" ? " (placeholder)" : ""}`;

  const record = async (
    role: "assistant" | "tool",
    raw: Record<string, unknown>,
    delta: { block: "text" | "tool"; text: string },
  ) =>
    withWorkspaceTx(deps.db, scope, async (tx) => {
      await tx.insert(schema.agentSessions).values({
        workspaceId: scope.workspaceId,
        sessionId,
        seq: seq++,
        runId,
        role,
        rawMessage: { ...raw, replayOf: recording.sessionId, label },
        modelServed: recording.modelServed,
        provenance: "replay",
      });
      await emit(
        tx,
        scope,
        "agent.delta",
        { sessionId, block: delta.block, text: delta.text },
        { runId, provenance: "replay", actor },
      );
    });

  // The quote is code's (C-09): DRAFT → QUOTED before the agent drafts anything.
  if (recording.purpose === "DRAFT_INVOICE") await quoteRun(deps, scope, runId);
  let invoiceId: string | null = null;
  let stoppedAt: ReplayOutcome["stoppedAt"] = null;
  for (const [i, step] of recording.steps.entries()) {
    if (step.kind === "text") {
      await record("assistant", { type: "text", text: step.text }, { block: "text", text: step.text });
      continue;
    }
    const result = await runStep(step, i);
    await record(
      "tool",
      { type: "tool_use", name: step.tool, input: step.input, ok: result.ok, verdict: result.verdict },
      { block: "tool", text: toolLine(step.tool, result.ok) },
    );
    if (!result.ok) {
      stoppedAt = { step: i, tool: step.tool, reason: result.reason };
      break;
    }
  }

  async function runStep(
    step: Extract<RecordedStep, { kind: "tool" }>,
    i: number,
  ): Promise<{ ok: boolean; verdict: string; reason: string }> {
    const fromPort = <T>(r: PortResult<T>) => ({
      ok: r.ok,
      verdict: r.verdict,
      reason: r.ok ? "" : `${r.error}: ${r.reason}`,
    });
    if (READS.has(step.tool) || step.tool === "propose_resolution") {
      // Read tools are recomputed on this workspace; they still pass the lattice and are recorded.
      const decision = await withWorkspaceTx(deps.db, scope, async (tx) => {
        const run = await runById(tx, scope, runId);
        const w = await invoiceWorld(tx, scope, deps, run);
        const ctx = await policyContext(tx, scope, deps, w, {
          today: todayOf(deps.clock.now()),
          budget: {
            spentMicros: 0,
            capMicros: limits.capMicros,
            iteration: i,
            maxIterations: session.maxIterations,
          },
        });
        return decideAndRecord(tx, scope, { name: step.tool, args: step.input }, ctx, {
          runId,
          sessionId,
          actor,
          at: deps.clock.now(),
          provenance: "replay",
        });
      });
      return {
        ok: decision.verdict !== "DENY",
        verdict: decision.verdict,
        reason: decision.decidedBy.join(", "),
      };
    }
    switch (step.tool) {
      case "create_invoice": {
        const labels = labelsOf(step.input);
        if (!labels) return { ok: false, verdict: "DENY", reason: "replay diverged: no item labels" };
        const r = await port.createRunInvoice({ runId, itemLabels: labels });
        if (r.ok) invoiceId = r.value.invoiceId;
        return fromPort(r);
      }
      case "send_invoice":
        return fromPort(
          await port.sendRunInvoice({ runId, invoiceId: invoiceId ?? (await currentInvoice()) ?? "" }),
        );
      case "create_conditional_rules_for_invoice":
        return fromPort(
          await port.addAutoCancelRule({ runId, invoiceId: invoiceId ?? (await currentInvoice()) ?? "" }),
        );
      case "get_invoice":
        return fromPort(await port.getInvoice({ runId }));
      case "get_payout_batch":
        return fromPort(await port.getPayoutBatch({ runId }));
      case "get_payout_item":
        return fromPort(
          await port.getPayoutItem({ runId, payoutItemId: String(step.input.payout_item_id ?? "") }),
        );
      case "request_payout_batch":
        return fromPort(await port.requestPayoutBatch({ runId }));
      default:
        return { ok: false, verdict: "DENY", reason: `replay diverged: ${step.tool}` };
    }
  }

  async function currentInvoice(): Promise<string | null> {
    const run = await runById(deps.db, scope, runId);
    const w = await withWorkspaceTx(deps.db, scope, (tx) => invoiceWorld(tx, scope, deps, run));
    return w.expected.invoiceId;
  }

  // The invoice turn always ends invoiced: whatever the replay did not finish, the checkpointed chain does.
  if (recording.purpose === "DRAFT_INVOICE") {
    const run = await runById(deps.db, scope, runId);
    if (run.state === "DRAFT" || run.state === "QUOTED") {
      await ensureInvoiceSent(deps, scope, runId, { approval: o.sendApproval });
    }
  }
  const after = await runById(deps.db, scope, runId);
  return { sessionId, steps: recording.steps.length, stoppedAt, runState: after.state };
}
