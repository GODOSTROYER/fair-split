// The public Proof stream (S3.7): `GET /v1/proof/:runSlug/events`, anonymous, at most 3 per hashed IP. It
// carries only aggregate counters ("3 of 8 confirmed") and the run's state, never a member, item or receiver:
// the payloads of the underlying `item.updated` events never leave the server.
//
// Like every public Proof read it exists only once the batch is posted (404 PROOF_NOT_READY before: nobody
// watches an unposted run move through review live) and it spends one of the caller's public-read slots.
//
// Each stream starts from the database's current counts and folds forward-only updates onto them (an item
// status only moves to a higher rank, a run only forward), so a replay from Last-Event-ID can never move a
// counter backwards. The counters are the primary batch's, exactly as `/v1/proof/:runSlug/metrics` (`progress`)
// reports them, which is where clients read the starting picture.
import {
  PAY_RUN_RANK,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  PayoutItemStatus as PayoutItemStatusSchema,
  PayRunState,
  Provenance,
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
import { findRunBySlug, notReady, proofReady, weakestProvenance } from "./bundle.js";
import { takePublicRead } from "./limits.js";
import { documentRawRoute, RUN_SLUG_PARAM } from "./openapi.js";

export const PROOF_STREAM_PATH = "/v1/proof/:runSlug/events";
export const PROOF_PROGRESS_EVENT = "proof.progress";

const Count = z.int().nonnegative();

export const ProofProgress = z.strictObject({
  runSlug: RunSlug,
  runState: PayRunState,
  provenance: Provenance,
  items: z.strictObject({
    total: Count,
    /** Replayed items, included in status counts and always labelled in display. */
    replayed: Count,
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

export function progressOf(
  runSlug: string,
  runState: PayRunState,
  statuses: Iterable<PayoutItemStatus>,
  provenances: Iterable<Provenance> = [],
  fallback: Provenance = "live",
) {
  const labels = [...provenances];
  const replayed = labels.filter((label) => label === "replay").length;
  const provenance = replayed > 0 ? "replay" : weakestProvenance(labels.length ? labels : [fallback]);
  const items = {
    total: 0,
    replayed,
    sent: 0,
    confirmed: 0,
    held: 0,
    parked: 0,
    returned: 0,
    failed: 0,
    reversed: 0,
  };
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
    provenance,
    items,
    display: `${items.confirmed} of ${items.total} confirmed${replayed > 0 ? ` · Replayed (labelled): ${replayed} of ${items.total} items from an earlier run · Simulated PayPal sandbox` : ""}`,
  };
  return progress;
}

/** The current status of every item of the run's primary batch, by sender_item_id. */
export async function currentItemStatuses(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<{ items: Map<string, PayoutItemStatus>; provenances: Map<string, Provenance> }> {
  const pb = schema.payoutBatches;
  const [batch] = await db
    .select({ id: pb.id })
    .from(pb)
    .where(and(eq(pb.workspaceId, workspaceId), eq(pb.runId, runId), eq(pb.kind, "primary")))
    .orderBy(desc(pb.submittedAt))
    .limit(1);
  const out = new Map<string, PayoutItemStatus>();
  const provenances = new Map<string, Provenance>();
  if (!batch) return { items: out, provenances };
  const rows = await db
    .select({
      senderItemId: schema.payoutItems.senderItemId,
      status: schema.payoutItems.status,
      provenance: schema.payoutItems.provenance,
    })
    .from(schema.payoutItems)
    .where(and(eq(schema.payoutItems.workspaceId, workspaceId), eq(schema.payoutItems.batchId, batch.id)));
  for (const r of rows) {
    out.set(r.senderItemId, r.status as PayoutItemStatus);
    provenances.set(r.senderItemId, Provenance.parse(r.provenance));
  }
  return { items: out, provenances };
}

/**
 * Folds one stored event onto the counters; returns whether anything moved. `state.items` is the primary batch,
 * read when the stream opened: the batch and all its items are written SUBMITTED with the POSTING transition,
 * before the Proof (and so this stream) exists. An item outside it is a re-route's (`r{seq}x{n}-M-…`, its own
 * batch), which the public counters never count, like `/metrics`.
 */
export function foldProgress(
  state: {
    runState: PayRunState;
    items: Map<string, PayoutItemStatus>;
    provenances?: Map<string, Provenance>;
    provenance?: Provenance;
  },
  e: Pick<StoredRunEvent, "type" | "payload"> & Partial<Pick<StoredRunEvent, "provenance">>,
): boolean {
  if (e.type === "run.state") {
    const to = PayRunState.safeParse(e.payload.to);
    if (!to.success || PAY_RUN_RANK[to.data] <= PAY_RUN_RANK[state.runState]) return false;
    state.runState = to.data;
    if (e.provenance) state.provenance = Provenance.parse(e.provenance);
    return true;
  }
  if (e.type === "item.updated") {
    const id = typeof e.payload.senderItemId === "string" ? e.payload.senderItemId : null;
    const to = PayoutItemStatusSchema.safeParse(e.payload.to);
    if (!id || !to.success) return false;
    const cur = state.items.get(id);
    if (cur === undefined || PAYOUT_ITEM_RANK[to.data] <= PAYOUT_ITEM_RANK[cur]) return false;
    state.items.set(id, to.data);
    if (e.provenance) state.provenances?.set(id, Provenance.parse(e.provenance));
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
      "Server-sent events named `proof.progress`, each the run's state and its primary batch's item counts, moved forward only (an item never to a lower rank, a run never back). Never an item, a member or a receiver. Anonymous; published once the batch is posted (404 `PROOF_NOT_READY` before); at most 3 streams per hashed IP, each opening spending one public Proof read. Resume with Last-Event-ID; read the starting picture from `/v1/proof/{runSlug}/metrics` (`progress`).",
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
    takePublicRead(ctx);
    if (!RunSlug.safeParse(runSlug).success) throw problem.notFound("No such pay run.");
    const deps = ctx.get("deps");
    const run = await findRunBySlug(deps.db, runSlug, deps.clock.now());
    if (!run) throw problem.notFound("No such pay run.");
    if (!proofReady(run)) notReady(run);
    const state = {
      runState: run.state,
      provenance: run.provenance,
      ...(await currentItemStatuses(deps.db, run.workspaceId, run.id)),
    };
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
          data: progressOf(
            run.runSlug,
            state.runState,
            state.items.values(),
            state.provenances.values(),
            state.provenance,
          ),
        };
      },
      label: "proof",
    });
  });
}
