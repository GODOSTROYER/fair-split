// The public Proof stream (S3.7): `GET /v1/proof/:runSlug/events`, anonymous, at most 3 per hashed IP. It
// carries only aggregate counters ("3 of 8 confirmed") and the run's state, never a member, item or receiver:
// the payloads of the underlying `item.updated` events never leave the server.
//
// Each stream starts from the database's current counts and folds forward-only updates onto them (an item
// status only moves to a higher rank, a run only forward), so a replay from Last-Event-ID can never move a
// counter backwards. Clients read the starting picture from `/v1/proof/:runSlug/metrics` (`progress`).
import {
  PAY_RUN_RANK,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  PayoutItemStatus as PayoutItemStatusSchema,
  PayRunState,
  RunSlug,
} from "@fairsplit/contracts";
import { type DbOrTx, type StoredRunEvent, schema } from "@fairsplit/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { toHonoPath } from "../lib/command.js";
import type { AppContext, AppEnv } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { parseLastEventId } from "../sse/envelope.js";
import { publicCaps } from "../sse/routes.js";
import { findRunBySlug } from "./bundle.js";
import { documentRawRoute, RUN_SLUG_PARAM } from "./openapi.js";

export const PROOF_STREAM_PATH = "/v1/proof/:runSlug/events";
export const PROOF_PROGRESS_EVENT = "proof.progress";

const Count = z.int().nonnegative();

export const ProofProgress = z.strictObject({
  runSlug: RunSlug,
  runState: PayRunState,
  items: z.strictObject({
    total: Count,
    /** SUBMITTED or PENDING: sent, not yet paid. */
    sent: Count,
    confirmed: Count,
    held: Count,
    /** UNCLAIMED: parked for a person's decision, never a failure. */
    parked: Count,
    returned: Count,
    failed: Count,
    reversed: Count,
  }),
  /** "3 of 8 confirmed". */
  display: z.string(),
});
export type ProofProgress = z.infer<typeof ProofProgress>;

export function progressOf(runSlug: string, runState: PayRunState, statuses: Iterable<PayoutItemStatus>) {
  const items = { total: 0, sent: 0, confirmed: 0, held: 0, parked: 0, returned: 0, failed: 0, reversed: 0 };
  for (const s of statuses) {
    items.total++;
    if (s === "SUBMITTED" || s === "PENDING") items.sent++;
    else if (s === "SUCCESS") items.confirmed++;
    else if (s === "ONHOLD") items.held++;
    else if (s === "UNCLAIMED") items.parked++;
    else if (s === "RETURNED") items.returned++;
    else if (s === "FAILED" || s === "BLOCKED") items.failed++;
    else items.reversed++;
  }
  const progress: ProofProgress = {
    runSlug,
    runState,
    items,
    display: `${items.confirmed} of ${items.total} confirmed`,
  };
  return progress;
}

/** The current status of every item of the run's primary batch, by sender_item_id. */
export async function currentItemStatuses(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<Map<string, PayoutItemStatus>> {
  const pb = schema.payoutBatches;
  const [batch] = await db
    .select({ id: pb.id })
    .from(pb)
    .where(and(eq(pb.workspaceId, workspaceId), eq(pb.runId, runId), eq(pb.kind, "primary")))
    .orderBy(desc(pb.submittedAt))
    .limit(1);
  const out = new Map<string, PayoutItemStatus>();
  if (!batch) return out;
  const rows = await db
    .select({ senderItemId: schema.payoutItems.senderItemId, status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .where(and(eq(schema.payoutItems.workspaceId, workspaceId), eq(schema.payoutItems.batchId, batch.id)));
  for (const r of rows) out.set(r.senderItemId, r.status as PayoutItemStatus);
  return out;
}

/** Folds one stored event onto the counters; returns whether anything moved. */
export function foldProgress(
  state: { runState: PayRunState; items: Map<string, PayoutItemStatus> },
  e: Pick<StoredRunEvent, "type" | "payload">,
): boolean {
  if (e.type === "run.state") {
    const to = PayRunState.safeParse(e.payload.to);
    if (!to.success || PAY_RUN_RANK[to.data] <= PAY_RUN_RANK[state.runState]) return false;
    state.runState = to.data;
    return true;
  }
  if (e.type === "item.updated") {
    const id = typeof e.payload.senderItemId === "string" ? e.payload.senderItemId : null;
    const to = PayoutItemStatusSchema.safeParse(e.payload.to);
    if (!id || !to.success) return false;
    const cur = state.items.get(id) ?? "SUBMITTED";
    if (state.items.has(id) && PAYOUT_ITEM_RANK[to.data] <= PAYOUT_ITEM_RANK[cur]) return false;
    state.items.set(id, to.data);
    return true;
  }
  return false;
}

export function mountProofStream(app: OpenAPIHono<AppEnv>): void {
  documentRawRoute(app, {
    path: "/v1/proof/{runSlug}/events",
    operationId: "proof.events",
    tag: "proof",
    summary: 'The public Proof stream: aggregate progress only ("3 of 8 confirmed")',
    description:
      "Server-sent events named `proof.progress`, each the run's state and its item counts, moved forward only (an item never to a lower rank, a run never back). Never an item, a member or a receiver. Anonymous; at most 3 streams per hashed IP. Resume with Last-Event-ID; read the starting picture from `/v1/proof/{runSlug}/metrics` (`progress`).",
    auth: "none",
    contentType: "text/event-stream",
    body: ProofProgress,
    params: [RUN_SLUG_PARAM],
    headers: [{ name: "Last-Event-ID", description: "Resume after this event id (SSE replay)" }],
    errors: [
      { status: 404, codes: ["NOT_FOUND"] },
      { status: 429, codes: ["RATE_LIMITED"] },
    ],
  });
  app.get(toHonoPath(PROOF_STREAM_PATH), async (c) => {
    const ctx = c as AppContext;
    const runSlug = c.req.param("runSlug") ?? "";
    if (!RunSlug.safeParse(runSlug).success) throw problem.notFound("No such pay run.");
    const deps = ctx.get("deps");
    const run = await findRunBySlug(deps.db, runSlug, deps.clock.now());
    if (!run) throw problem.notFound("No such pay run.");
    const state = { runState: run.state, items: await currentItemStatuses(deps.db, run.workspaceId, run.id) };
    return deps.sse.open(ctx, {
      scope: { workspaceId: run.workspaceId, runId: run.id },
      caps: publicCaps(ctx),
      lastEventId: parseLastEventId(c.req.header("last-event-id"), c.req.query("lastEventId")),
      filter: (e) => e.type === "item.updated" || e.type === "run.state",
      project: (e) => {
        if (!foldProgress(state, e)) return null;
        return {
          id: String(e.id),
          event: PROOF_PROGRESS_EVENT,
          data: progressOf(run.runSlug, state.runState, state.items.values()),
        };
      },
      label: "proof",
    });
  });
}
