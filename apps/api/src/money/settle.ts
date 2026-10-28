// Settlement (S3.6.5, S3.6.6). We never poll: a payout batch is read at +25 s (Judge Mode) or +90 s after the
// POST, again at +90 s and +10 min only while an item is open, and at once on a PAYOUTSBATCH.SUCCESS event.
// Every status lands through `applyItem` (forward-only ranks; RETURNED only after our cancel), and the run
// follows: POSTED → SETTLING on the first sign of processing; SETTLED when every item is terminal and
// handled; NEEDS_FOLLOW_UP while an item is parked (Rhea's UNCLAIMED) or failed, until a person moves it.
//
// `processWebhook` applies a stored, verified event under WS-PPCORE's contract (webhooks/apply.ts): a
// signature-verified PAYOUTS-ITEM.SUCCEEDED applies at once (MM-1); anything else changes no state until a
// fresh GET says what to change. Every applied event is a `webhook.applied` ledger entry (Proof plate 6).
import {
  type PayoutBatchStatus,
  type PayoutItemStatus,
  type PayRunState,
  type Provenance,
  TASKS,
  type WebhookEventType,
  WebhookEventType as WebhookEventTypeSchema,
  type WebhookVerified,
} from "@fairsplit/contracts";
import {
  type DbOrTx,
  schema,
  systemScope,
  type Tx,
  type WorkspaceScope,
  withWorkspaceTx,
} from "@fairsplit/db";
import { itemMachine } from "@fairsplit/domain";
import { enqueue, type TaskContext } from "@fairsplit/outbox";
import { getPayoutBatch, getPayoutItem } from "@fairsplit/paypal-payouts";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { ACTORS, emit, proofLedger } from "../runs/events.js";
import { lockRun } from "../runs/load.js";
import { cause, moveRun } from "../runs/machine.js";
import { SETTLE_GET_DELAYS_MS, webhookApplyRule } from "../webhooks/apply.js";
import { classifyPayPal } from "./errors.js";
import { confirmFunding } from "./funding.js";
import { applyItem, type ItemRow, itemStatusOf } from "./items.js";

type Deps = Pick<AppDeps, "db" | "env" | "paypal" | "clock" | "logger">;

const CONTEXT = { sandbox: true } as const;
const BATCH: Readonly<Record<string, PayoutBatchStatus>> = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  DENIED: "DENIED",
  CANCELED: "CANCELED",
  CANCELLED: "CANCELED",
};
/** Follow-up settle GETs: +90 s, then +10 min, only while an item is open. */
export const FOLLOW_UP_DELAYS_MS: readonly number[] = [SETTLE_GET_DELAYS_MS.standard, 10 * 60_000];
const PARKED_OR_FAILED: ReadonlySet<PayoutItemStatus> = new Set(["UNCLAIMED", "FAILED", "BLOCKED", "ONHOLD"]);

function cents(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [w, f = ""] = v.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/**
 * Where the run stands once its items moved: SETTLING on the first sign of processing; SETTLED when every
 * item is terminal and its line is handled (paid, or moved to cash); NEEDS_FOLLOW_UP while one is parked
 * or failed. A FOLLOW_UP run settles when the last parked line is handled.
 */
export async function advanceRun(
  tx: DbOrTx,
  scope: WorkspaceScope,
  runId: string,
  provenance: Provenance,
): Promise<PayRunState> {
  let run = await lockRun(tx, scope, runId);
  const items = await tx
    .select({ status: schema.payoutItems.status, lineState: schema.memberLines.state })
    .from(schema.payoutItems)
    .innerJoin(schema.payoutBatches, eq(schema.payoutBatches.id, schema.payoutItems.batchId))
    .innerJoin(schema.memberLines, eq(schema.memberLines.id, schema.payoutItems.lineId))
    .where(and(eq(schema.payoutItems.workspaceId, scope.workspaceId), eq(schema.payoutBatches.runId, runId)));
  if (items.length === 0) return run.state as PayRunState;
  const statuses = items.map((i) => i.status as PayoutItemStatus);
  const moving = statuses.some((s) => s !== "SUBMITTED" && s !== "PENDING");
  const move = async (to: PayRunState, code: string) => {
    run = await moveRun(tx, scope, {
      id: run.id,
      from: run.state as PayRunState,
      to,
      version: run.version,
      cause: cause(code),
      provenance,
      actor: ACTORS.paypalGet,
    });
  };
  if (run.state === "POSTED" && moving) await move("SETTLING", "PROCESSING");
  const handled = (s: PayoutItemStatus, line: string) =>
    s === "SUCCESS" ||
    s === "REFUNDED" ||
    s === "REVERSED" ||
    ((s === "RETURNED" || PARKED_OR_FAILED.has(s)) && (line === "OFF_RAIL_DUE" || line === "OFF_RAIL_PAID"));
  const allHandled = items.every((i) => handled(i.status as PayoutItemStatus, i.lineState));
  const stillPending = statuses.some((s) => s === "SUBMITTED" || s === "PENDING");
  if (run.state === "SETTLING") {
    if (allHandled) await move("SETTLED", "ALL_TERMINAL");
    else if (!stillPending) await move("NEEDS_FOLLOW_UP", "FOLLOW_UP");
  } else if (run.state === "NEEDS_FOLLOW_UP" && allHandled) {
    await move("SETTLED", "FOLLOW_UP_DONE");
  }
  return run.state as PayRunState;
}

interface BatchItemView {
  payout_item_id?: string;
  transaction_status?: string;
  payout_item_fee?: { value?: string; currency?: string };
  payout_item?: { sender_item_id?: string };
  errors?: unknown;
}

/** settleBatch {batchId, n}: one GET of the batch, statuses applied by rank, the next GET only while items are open. */
export async function settleBatch(
  deps: Deps,
  args: { batchId: string; n: number },
  ctx: Pick<TaskContext, "workspaceId">,
): Promise<void> {
  const [batch] = await deps.db
    .select()
    .from(schema.payoutBatches)
    .where(
      and(
        eq(schema.payoutBatches.id, args.batchId),
        ...(ctx.workspaceId ? [eq(schema.payoutBatches.workspaceId, ctx.workspaceId)] : []),
      ),
    );
  if (!batch?.paypalBatchId) return;
  const scope = systemScope(batch.workspaceId, ACTORS.paypalGet);
  const provenance = deps.paypal.provenance;
  const got = await getPayoutBatch(
    deps.paypal.core.http,
    CONTEXT,
    { payout_batch_id: batch.paypalBatchId, page: 1, page_size: 100, total_required: true },
    { priority: "background" },
  );
  if (!got.ok) throw classifyPayPal(new Error(`${got.status} ${got.name}`), "the batch status check");
  const views = (got.body.items ?? []) as BatchItemView[];
  const open = await withWorkspaceTx(deps.db, scope, async (tx) => {
    const status = BATCH[got.body.batch_header?.batch_status ?? ""];
    if (status && status !== batch.status) {
      await tx.update(schema.payoutBatches).set({ status }).where(eq(schema.payoutBatches.id, batch.id));
    }
    const items = await tx
      .select()
      .from(schema.payoutItems)
      .where(
        and(eq(schema.payoutItems.workspaceId, batch.workspaceId), eq(schema.payoutItems.batchId, batch.id)),
      );
    for (const view of views) {
      const item = items.find((i) => i.senderItemId === view.payout_item?.sender_item_id);
      const next = itemStatusOf(view.transaction_status);
      if (!item || !next) continue;
      await applyItem(tx, scope, item, {
        status: next,
        source: "status_check",
        eventId: null,
        provenance,
        actor: ACTORS.paypalGet,
        payoutItemId: view.payout_item_id ?? null,
        transactionStatus: view.transaction_status ?? null,
        feeCents: cents(view.payout_item_fee?.value),
        ...(view.errors ? { errors: view.errors } : {}),
      });
    }
    await advanceRun(tx, scope, batch.runId, provenance);
    const now = await tx
      .select({ status: schema.payoutItems.status })
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.batchId, batch.id));
    const stillOpen = now.some((i) => !itemMachine.isTerminal(i.status as PayoutItemStatus));
    const delay = FOLLOW_UP_DELAYS_MS[args.n - 1];
    if (stillOpen && delay !== undefined) {
      const next = { batchId: batch.id, n: args.n + 1 };
      await enqueue(tx as Tx, "settleBatch", next, TASKS.settleBatch.dedupeKey(next), {
        workspaceId: batch.workspaceId,
        runAfter: new Date(deps.clock.now().getTime() + delay),
        // the follow-ups are background reads
      });
    }
    return stillOpen;
  });
  deps.logger.debug({ batchId: batch.id, n: args.n, open }, "settle GET applied");
}

// ---------------------------------------------------------------- processWebhook

interface WebhookResource {
  id?: string;
  invoice?: { id?: string };
  payout_item_id?: string;
  payout_batch_id?: string;
  transaction_status?: string;
  payout_item?: { sender_item_id?: string };
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: string;
    sender_batch_header?: { sender_batch_id?: string };
  };
}

type Resolved =
  | { kind: "item"; workspaceId: string; item: ItemRow; runId: string }
  | { kind: "batch"; workspaceId: string; batchId: string; runId: string }
  | { kind: "invoice"; workspaceId: string; runId: string; invoiceNumber: string }
  | { kind: "orphan" };

async function resolve(db: DbOrTx, eventType: string, r: WebhookResource): Promise<Resolved> {
  if (eventType.startsWith("INVOICING.INVOICE.")) {
    const id = r.invoice?.id ?? r.id;
    if (!id) return { kind: "orphan" };
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.paypalInvoiceId, id));
    return inv
      ? { kind: "invoice", workspaceId: inv.workspaceId, runId: inv.runId, invoiceNumber: inv.invoiceNumber }
      : { kind: "orphan" };
  }
  if (eventType.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const id = r.batch_header?.payout_batch_id;
    if (!id) return { kind: "orphan" };
    const [b] = await db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.paypalBatchId, id));
    return b
      ? { kind: "batch", workspaceId: b.workspaceId, batchId: b.id, runId: b.runId }
      : { kind: "orphan" };
  }
  if (eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    // Items join through their batch first (never by sender_item_id alone, S3.6.5).
    const batchId = r.payout_batch_id;
    const senderItemId = r.payout_item?.sender_item_id;
    if (!batchId) return { kind: "orphan" };
    const [b] = await db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.paypalBatchId, batchId));
    if (!b) return { kind: "orphan" };
    const items = await db
      .select()
      .from(schema.payoutItems)
      .where(and(eq(schema.payoutItems.workspaceId, b.workspaceId), eq(schema.payoutItems.batchId, b.id)));
    const item =
      items.find((i) => r.payout_item_id && i.payoutItemId === r.payout_item_id) ??
      items.find((i) => senderItemId && i.senderItemId === senderItemId);
    return item ? { kind: "item", workspaceId: b.workspaceId, item, runId: b.runId } : { kind: "orphan" };
  }
  return { kind: "orphan" };
}

export async function processWebhook(
  deps: Deps,
  args: { webhookEventId: string; paypalEventId: string },
  ctx: Pick<TaskContext, "complete">,
): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.id, args.webhookEventId));
  if (!row || row.status === "applied" || row.status === "rejected") return;
  let body: { id?: string; event_type?: string; resource?: WebhookResource } = {};
  try {
    body = JSON.parse(row.raw) as typeof body;
  } catch {
    // unreadable: stored as an orphan below
  }
  const eventType = body.event_type ?? row.eventType;
  const typed = WebhookEventTypeSchema.safeParse(eventType);
  const verified = (row.verified ?? "fetched") as WebhookVerified;
  const resource = body.resource ?? {};
  const target = typed.success ? await resolve(deps.db, eventType, resource) : ({ kind: "orphan" } as const);
  const provenance = deps.paypal.provenance;

  if (target.kind === "orphan") {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(schema.webhookEvents)
        .set({ status: "orphan" })
        .where(eq(schema.webhookEvents.id, row.id));
      await ctx.complete(tx);
    });
    return;
  }
  const scope = systemScope(target.workspaceId, ACTORS.paypalWebhook);
  const eventTypeOk = typed.success ? (typed.data as WebhookEventType) : null;

  // PayPal's word first, when the rule says a GET must decide (S3.6.5). Without an item id to GET (PayPal names
  // items only in the settle GET), the event changes nothing and the batch GET decides.
  let fresh: { status: PayoutItemStatus | null; payoutItemId: string | null } | null = null;
  let batchGetDecides = false;
  if (target.kind === "item") {
    // `webhook_events` has no `delivery` column yet (WS-DATA): nothing records that the certificate was in
    // date, so the rule fails closed (DELIVERY_NOT_RECORDED) and a fresh GET decides every event, a signed
    // SUCCEEDED included (MM-1 then follows the +25 s / +90 s settle GET instead of the webhook).
    const rule = webhookApplyRule({ eventType, verified, delivery: null });
    if (rule.action === "fresh_get_first") {
      const id = resource.payout_item_id ?? target.item.payoutItemId;
      if (id) {
        const got = await getPayoutItem(
          deps.paypal.core.http,
          CONTEXT,
          { payout_item_id: id },
          { priority: "background" },
        );
        if (!got.ok)
          throw classifyPayPal(new Error(`${got.status} ${got.name}`), "the payout item status check");
        fresh = {
          status: itemStatusOf(got.body.transaction_status),
          payoutItemId: got.body.payout_item_id ?? id,
        };
      } else {
        batchGetDecides = true;
      }
    }
  }
  if (target.kind === "invoice" && eventType === "INVOICING.INVOICE.PAID") {
    // PAID pulls the funding GET forward (the GET decides; the event corroborates).
    await confirmFunding(deps, scope, target.runId).catch((e) => {
      deps.logger.warn(
        { err: e, runId: target.runId },
        "funding GET after INVOICE.PAID failed; the 60 s fallback remains",
      );
    });
  }

  await withWorkspaceTx(deps.db, scope, async (tx) => {
    await tx
      .update(schema.webhookEvents)
      .set({
        workspaceId: target.workspaceId,
        status: "applied",
        appliedAt: deps.clock.now(),
        resourceKey: resourceKeyOf(target),
      })
      .where(eq(schema.webhookEvents.id, row.id));
    const runId = target.runId;
    await emit(
      tx,
      scope,
      "webhook.received",
      { webhookEventId: row.id, paypalEventId: row.paypalEventId, eventType, verified, duplicate: false },
      { runId, provenance, actor: ACTORS.paypalWebhook },
    );
    const at = deps.clock.now();
    if (target.kind === "item" && eventTypeOk && batchGetDecides) {
      // Nothing to GET by id yet: change nothing; the settle GET (due within 10 s, or brought forward) decides.
      await settleGetSoon(tx, deps, target.workspaceId, target.item.batchId, row.paypalEventId);
    } else if (target.kind === "item" && eventTypeOk) {
      // Either the GET's answer, or a signature-verified SUCCEEDED (apply contract rule 2).
      const status = fresh ? fresh.status : itemStatusOf(eventType);
      if (status) {
        const [item] = await tx
          .select()
          .from(schema.payoutItems)
          .where(eq(schema.payoutItems.id, target.item.id))
          .for("update");
        if (item) {
          const applied = await applyItem(tx, scope, item, {
            status,
            source: fresh ? "status_check" : "webhook",
            eventId: row.paypalEventId,
            provenance,
            actor: ACTORS.paypalWebhook,
            payoutItemId: fresh?.payoutItemId ?? resource.payout_item_id ?? null,
            transactionStatus: resource.transaction_status ?? null,
          });
          if (applied.applied) {
            await proofLedger(
              tx,
              scope,
              "webhook.applied",
              {
                eventId: row.paypalEventId,
                eventType: eventTypeOk,
                verified,
                provenance,
                resource: "payout_item",
                senderItemId: item.senderItemId,
                payoutItemId: fresh?.payoutItemId ?? resource.payout_item_id ?? item.payoutItemId ?? "",
                status,
              },
              { runId, at, actor: ACTORS.paypalWebhook },
            );
          }
          await advanceRun(tx, scope, runId, provenance);
        }
      }
    } else if (target.kind === "batch" && eventTypeOk) {
      // A batch event never writes the batch's status or moves the run from its own payload (apply contract
      // rule 3): SUCCESS runs the settle GET at once, DENIED is confirmed by that GET, and PROCESSING waits for
      // the scheduled one (+25 s / +90 s after the POST; we never poll). The GET writes status and run state.
      const named = BATCH[eventType.split(".").pop() ?? ""];
      if (named === "SUCCESS" || named === "DENIED") {
        await enqueueSettleNow(tx, target.workspaceId, target.batchId, row.paypalEventId);
      }
    } else if (target.kind === "invoice" && eventTypeOk) {
      const [inv] = await tx
        .select()
        .from(schema.invoices)
        .where(and(eq(schema.invoices.workspaceId, target.workspaceId), eq(schema.invoices.runId, runId)));
      if (inv) {
        await proofLedger(
          tx,
          scope,
          "webhook.applied",
          {
            eventId: row.paypalEventId,
            eventType: eventTypeOk,
            verified,
            provenance,
            resource: "invoice",
            invoiceNumber: inv.invoiceNumber,
            status: inv.status === "NEW" ? "DRAFT" : inv.status,
          },
          { runId, at, actor: ACTORS.paypalWebhook },
        );
      }
    }
    await ctx.complete(tx);
  });
}

/** The settle GET at once, keyed to the event that asked for it (its follow-ups dedupe with the regular chain). */
async function enqueueSettleNow(
  tx: Tx,
  workspaceId: string,
  batchId: string,
  eventId: string,
): Promise<void> {
  const next = { batchId, n: 1 };
  await enqueue(tx, "settleBatch", next, `${TASKS.settleBatch.dedupeKey(next)}:wh:${eventId}`, {
    workspaceId,
  });
}

/** How soon a scheduled settle GET must be due for an item event to wait for it (S3.6.5). */
export const SETTLE_SOON_MS = 10_000;

/** S3.6.5: "use the settleBatch GET if one is due within 10 s"; otherwise bring one forward. */
async function settleGetSoon(
  tx: Tx,
  deps: Deps,
  workspaceId: string,
  batchId: string,
  eventId: string,
): Promise<void> {
  const t = schema.taskOutbox;
  const [due] = await tx
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        eq(t.name, "settleBatch"),
        inArray(t.state, ["queued", "dispatched"]),
        sql`${t.args}->>'batchId' = ${batchId}`,
        lte(t.runAfter, new Date(deps.clock.now().getTime() + SETTLE_SOON_MS)),
      ),
    )
    .limit(1);
  if (!due) await enqueueSettleNow(tx, workspaceId, batchId, eventId);
}

function resourceKeyOf(t: Exclude<Resolved, { kind: "orphan" }>): string {
  if (t.kind === "item") return t.item.payoutItemId ?? t.item.senderItemId;
  if (t.kind === "batch") return t.batchId;
  return t.invoiceNumber;
}

/** Settle GETs still due for a run's batches (for reads and /ops). */
export async function openItems(db: DbOrTx, scope: WorkspaceScope, runId: string): Promise<number> {
  const rows = await db
    .select({ status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .innerJoin(schema.payoutBatches, eq(schema.payoutBatches.id, schema.payoutItems.batchId))
    .where(
      and(
        eq(schema.payoutItems.workspaceId, scope.workspaceId),
        eq(schema.payoutBatches.runId, runId),
        inArray(schema.payoutItems.status, ["SUBMITTED", "PENDING", "ONHOLD", "UNCLAIMED"]),
      ),
    );
  return rows.length;
}
