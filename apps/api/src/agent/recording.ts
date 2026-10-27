// Agent session recordings (C-06): Judge Mode replays Claude's recorded session instead of calling the model;
// PayPal calls still run live on the replayed inputs, through the live policy lattice.
//
// A recording is the session's assistant turns as stored in `agent_sessions` (raw Messages API blocks, in
// order): `text` blocks become the Machine lane's prose, `tool_use` blocks are the calls. Until the 28 Oct
// recording exists, a labelled placeholder (`seed_synthetic`, never a real model answer, S4.9) stands in,
// with Claude's three item labels; the UI names it as such.
import { AGENT_TOOL_NAMES, AgentPurpose, type AgentToolName } from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

export const RecordedStep = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string().max(2_000) }),
  z.strictObject({
    kind: z.literal("tool"),
    tool: z.enum(AGENT_TOOL_NAMES),
    input: z.record(z.string(), z.unknown()),
  }),
]);
export type RecordedStep = z.infer<typeof RecordedStep>;

export const AgentRecording = z.strictObject({
  v: z.literal(1),
  sessionId: z.string(),
  purpose: AgentPurpose,
  /** The day it was recorded; the Machine lane labels the replay with it. */
  recordedOn: z.iso.date(),
  model: z.literal("claude-opus-5-5"),
  modelServed: z.string(),
  /** `replay` for a real recorded session; `seed_synthetic` for the labelled placeholder. */
  provenance: z.enum(["replay", "seed_synthetic"]),
  steps: z.array(RecordedStep).min(1),
});
export type AgentRecording = z.infer<typeof AgentRecording>;

/** The labelled placeholder for the invoice turn (S4.9: written from the seed, never a model answer). */
export const PLACEHOLDER_DRAFT_INVOICE: AgentRecording = AgentRecording.parse({
  v: 1,
  sessionId: "placeholder-draft-invoice-v1",
  purpose: "DRAFT_INVOICE",
  recordedOn: "2026-10-24",
  model: "claude-opus-5-5",
  modelServed: "claude-opus-5-5 (placeholder)",
  provenance: "seed_synthetic",
  steps: [
    { kind: "text", text: "Checking the quote against the ratified rate card before drafting anything." },
    { kind: "tool", tool: "get_invoice_quote", input: {} },
    { kind: "tool", tool: "get_rate_card", input: {} },
    {
      kind: "text",
      text: "The quote follows Schedule A. Drafting Lantern Bay's invoice with three item labels.",
    },
    {
      kind: "tool",
      tool: "create_invoice",
      input: {
        item_labels: {
          premium: "Fair-trade premium",
          bonus: "Quality bonus (Grade one)",
          disbursement: "Disbursement costs",
        },
      },
    },
    { kind: "tool", tool: "send_invoice", input: {} },
    { kind: "tool", tool: "create_conditional_rules_for_invoice", input: {} },
    { kind: "text", text: "Sent to Lantern Bay with the auto-cancel rule. Waiting for their payment." },
  ],
});

export const PLACEHOLDER_REQUEST_BATCH: AgentRecording = AgentRecording.parse({
  v: 1,
  sessionId: "placeholder-request-batch-v1",
  purpose: "REQUEST_BATCH",
  recordedOn: "2026-10-24",
  model: "claude-opus-5-5",
  modelServed: "claude-opus-5-5 (placeholder)",
  provenance: "seed_synthetic",
  steps: [
    { kind: "tool", tool: "get_run_summary", input: {} },
    { kind: "tool", tool: "list_holds", input: {} },
    { kind: "text", text: "No hold blocks approval. Asking the treasurer to sign the batch." },
    { kind: "tool", tool: "request_payout_batch", input: {} },
  ],
});

interface RawBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
}

/** S4.4's wrapper names, recorded by the agent, as the lattice's tool names. */
const WRAPPERS: Readonly<Record<string, AgentToolName>> = {
  create_run_invoice: "create_invoice",
  send_run_invoice: "send_invoice",
  add_auto_cancel_rule: "create_conditional_rules_for_invoice",
};

/** A session stored in `agent_sessions` (raw assistant messages in seq order) as a recording; null if unusable. */
export async function recordingFromSessions(
  db: DbOrTx,
  sessionId: string,
  meta: { purpose: AgentRecording["purpose"]; recordedOn: string },
): Promise<AgentRecording | null> {
  const rows = await db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.sessionId, sessionId))
    .orderBy(asc(schema.agentSessions.seq));
  const steps: RecordedStep[] = [];
  let served = "claude-opus-5-5";
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    if (row.modelServed) served = row.modelServed;
    const message = row.rawMessage as { content?: unknown };
    const blocks = Array.isArray(message?.content) ? (message.content as RawBlock[]) : [];
    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim())
        steps.push({ kind: "text", text: b.text.slice(0, 2_000) });
      if (b.type === "tool_use" && typeof b.name === "string") {
        const tool = WRAPPERS[b.name] ?? b.name;
        if ((AGENT_TOOL_NAMES as readonly string[]).includes(tool)) {
          steps.push({
            kind: "tool",
            tool: tool as AgentToolName,
            input: (b.input ?? {}) as Record<string, unknown>,
          });
        }
      }
    }
  }
  const parsed = AgentRecording.safeParse({
    v: 1,
    sessionId,
    purpose: meta.purpose,
    recordedOn: meta.recordedOn,
    model: "claude-opus-5-5",
    modelServed: served,
    provenance: "replay",
    steps,
  });
  return parsed.success ? parsed.data : null;
}
