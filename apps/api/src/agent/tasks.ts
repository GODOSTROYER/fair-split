// The agentTurn task (S4.4, C-06). Judge Mode always replays the recorded session; the model is never called
// from fs-api. The invoice turn (DRAFT_INVOICE) runs its PayPal steps live through the AgentMoneyPort and
// hands any unfinished step to the checkpointed ensureInvoice chain; REQUEST_BATCH only opens an approval
// request. The live agent loop (dev, nightly eval) is WS-AGENT's and calls the same port.
import { TaskArgs } from "@fairsplit/contracts";
import { schema, systemScope } from "@fairsplit/db";
import type { TaskHandlers } from "@fairsplit/outbox";
import { and, eq, sql } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import type { SendApproval } from "../money/funding.js";
import { ACTORS } from "../runs/events.js";
import { report } from "../runs/now.js";
import { type AgentRecording, PLACEHOLDER_DRAFT_INVOICE, PLACEHOLDER_REQUEST_BATCH } from "./recording.js";
import { replaySession } from "./replay.js";

/** The recording a purpose replays: the 28 Oct session once recorded, else the labelled placeholder. */
export function recordingFor(purpose: AgentRecording["purpose"]): AgentRecording | null {
  if (purpose === "DRAFT_INVOICE") return PLACEHOLDER_DRAFT_INVOICE;
  if (purpose === "REQUEST_BATCH") return PLACEHOLDER_REQUEST_BATCH;
  return null;
}

export async function sendApprovalFor(
  deps: Pick<AppDeps, "db" | "clock">,
  workspaceId: string,
  runId: string,
): Promise<SendApproval | null> {
  const [ws] = await deps.db
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  // Judge Mode: the first press is the treasurer's approval of the send ("Judge as Treasurer approved send").
  if (ws?.kind === "judge") return { approverId: "judge", at: deps.clock.now() };
  const [entry] = await deps.db
    .select({ actorId: schema.ledgerEntries.actorId, at: schema.ledgerEntries.at })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, workspaceId),
        eq(schema.ledgerEntries.kind, "invoice.send_approved"),
        sql`${schema.ledgerEntries.payload}->>'runId' = ${runId}`,
      ),
    )
    .limit(1);
  return entry ? { approverId: entry.actorId, at: entry.at } : null;
}

export function agentTasks(deps: AppDeps): TaskHandlers {
  return {
    agentTurn: async (raw, ctx) => {
      const args = TaskArgs.agentTurn.parse(raw);
      if (!ctx.workspaceId) throw new Error("agentTurn needs its workspace");
      const scope = systemScope(ctx.workspaceId, ACTORS.outbox);
      const recording = recordingFor(args.purpose);
      if (!recording) {
        report(ctx.outboxId, {
          ok: true,
          detail: { replayed: false, reason: "no recording for this purpose" },
        });
        return;
      }
      const out = await replaySession(deps, scope, args.runId, recording, {
        sendApproval: await sendApprovalFor(deps, ctx.workspaceId, args.runId),
      });
      report(ctx.outboxId, {
        ok: true,
        detail: { sessionId: out.sessionId, runState: out.runState, stopped: out.stoppedAt?.reason ?? null },
      });
    },
  };
}
