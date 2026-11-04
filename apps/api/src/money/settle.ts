// Settlement (S3.6.5, S3.6.6). We never poll: a payout batch is read at +25 s (Judge Mode) or +90 s after the
// POST, again at +90 s and +10 min only while an item is open, and at once on a PAYOUTSBATCH.SUCCESS event. A
// follow-up that comes due once every item is terminal reads nothing, and a batch a restart of the in-process
// simulator stranded (STRANDED_BATCH, recorded at boot by paypal/boot.ts) is never read again.
// Every status lands through `applyItem` (forward-only ranks; RETURNED only after our cancel), and the run
// follows: POSTED → SETTLING on the first sign of processing; SETTLED when every item is terminal and
// handled; NEEDS_FOLLOW_UP while an item is parked (Rhea's UNCLAIMED) or failed, until a person moves it.
//
// `processWebhook` applies a stored, verified event under WS-PPCORE's contract (webhooks/apply.ts): a
// signature-verified PAYOUTS-ITEM.SUCCEEDED applies at once (MM-1); anything else changes no state until a
// fresh GET says what to change. Every applied event is a `webhook.applied` ledger entry (Proof plate 6). So is a
// verified event that confirms the status its item already holds (`confirmsHeldStatus`), so that every status rests
// on a verified event even when it landed first: our cancel's RETURNED, or a SUCCESS the settle GET read first.
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
import {
  parseWebhookEnvelope,
  type ResourceRef,
  resourceRefOf,
  storedWebhookApplyRule,
} from "@fairsplit/paypal-core";
import { getPayoutBatch, getPayoutItem } from "@fairsplit/paypal-payouts";
import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { ACTORS, emit, proofLedger } from "../runs/events.js";
import { lockRun } from "../runs/load.js";
import { cause, moveRun } from "../runs/machine.js";
import { SETTLE_GET_DELAYS_MS } from "../webhooks/apply.js";
import { classifyPayPal } from "./errors.js";
import { confirmFunding } from "./funding.js";
import { applyItem, type ItemRow, itemStatusOf } from "./items.js";
import { replayDepsForRun } from "./rail.js";

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

/**
 * A batch the previous in-process simulator accepted and a restart stranded (ADR-0010: the simulator's state lives in
 * the process, so the one running now never issued it and no GET can say anything about it). paypal/boot.ts records
 * each such batch once, at boot, as a `payout.stranded` ledger entry in its workspace (ids, counts and the codes below
 * only, S3.12). Nothing else changes: every item keeps the last status the simulator reported (none is marked paid,
 * failed or returned), the run stays where it stood, and the batch's settle GETs end at once with no PayPal call
 * instead of retrying until dead. A judge workspace's demo run ends there (its session is ended at the same boot);
 * any other workspace is left as it stands for a person, never rewritten.
 */
export const STRANDED_BATCH = {
  kind: "payout.stranded",
  reason: "simulator_restarted",
  judge: {
    outcome: "demo_run_ended",
    label: "The simulated PayPal sandbox restarted; this demo run ended",
  },
  other: {
    outcome: "left_for_a_person",
    label:
      "The simulated PayPal sandbox restarted and no longer holds this batch: its items keep the last status it reported, nothing is marked paid, failed or returned, and a person decides what happens to each line",
  },
} as const;

/** Whether `batchId` was recorded stranded in its workspace's ledger (STRANDED_BATCH). */
export async function isStrandedBatch(db: DbOrTx, workspaceId: string, batchId: string): Promise<boolean> {
  const l = schema.ledgerEntries;
  const [row] = await db
    .select({ seq: l.seq })
    .from(l)
    .where(
      and(
        eq(l.workspaceId, workspaceId),
        eq(l.kind, STRANDED_BATCH.kind),
        sql`${l.payload}->>'batchId' = ${batchId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
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
    .where(
      and(
        eq(schema.payoutItems.workspaceId, scope.workspaceId),
        eq(schema.payoutBatches.runId, runId),
        sql`NOT EXISTS (select 1 from payout_items n where n.supersedes_item_id = ${schema.payoutItems.id})`,
      ),
    );
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
  // stranded by a restart of the in-process simulator: no GET can learn anything; nothing is marked (STRANDED_BATCH)
  if (await isStrandedBatch(deps.db, batch.workspaceId, batch.id)) {
    deps.logger.info(
      { batchId: batch.id, n: args.n, reason: STRANDED_BATCH.reason },
      "settle GET skipped: the batch was stranded by a simulator restart",
    );
    return;
  }
  // a follow-up (+90 s, +10 min) exists only for open items: once every item is terminal it has nothing to read
  if (args.n > 1) {
    const held = await deps.db
      .select({ status: schema.payoutItems.status })
      .from(schema.payoutItems)
      .where(
        and(eq(schema.payoutItems.workspaceId, batch.workspaceId), eq(schema.payoutItems.batchId, batch.id)),
      );
    if (held.length > 0 && held.every((i) => itemMachine.isTerminal(i.status as PayoutItemStatus))) {
      deps.logger.debug(
        { batchId: batch.id, n: args.n },
        "follow-up settle GET skipped: every item is terminal",
      );
      return;
    }
  }
  const scope = systemScope(batch.workspaceId, ACTORS.paypalGet);
  // A replayed batch (Judge Mode's replay rail) is settled by the replay too: no PayPal call, rows `replay`.
  const rail =
    batch.provenance === "replay" ? await replayDepsForRun(deps, batch.workspaceId, batch.runId) : deps;
  const provenance = rail.paypal.provenance;
  const got = await getPayoutBatch(
    rail.paypal.core.http,
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
        at: deps.clock.now(),
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

type Resolved =
  | { kind: "item"; workspaceId: string; item: ItemRow; runId: string; paypalBatchId: string }
  | { kind: "batch"; workspaceId: string; batchId: string; runId: string }
  | { kind: "invoice"; workspaceId: string; runId: string; invoiceNumber: string }
  | { kind: "orphan" };

/** PayPal IDs are globally unique, including siblings not yet named on the incoming sender's row. */
async function itemIdTaken(db: DbOrTx, payoutItemId: string | null, itemId: string): Promise<boolean> {
  if (!payoutItemId) return false;
  const [other] = await db
    .select({ id: schema.payoutItems.id })
    .from(schema.payoutItems)
    .where(and(eq(schema.payoutItems.payoutItemId, payoutItemId), ne(schema.payoutItems.id, itemId)))
    .limit(1);
  return other !== undefined;
}

async function resolve(db: DbOrTx, r: ResourceRef): Promise<Resolved> {
  if (r.kind === "invoice") {
    const id = r.invoiceId;
    if (!id) return { kind: "orphan" };
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.paypalInvoiceId, id));
    return inv
      ? { kind: "invoice", workspaceId: inv.workspaceId, runId: inv.runId, invoiceNumber: inv.invoiceNumber }
      : { kind: "orphan" };
  }
  if (r.kind === "payout_batch") {
    const id = r.payoutBatchId;
    if (!id) return { kind: "orphan" };
    const [b] = await db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.paypalBatchId, id));
    return b
      ? { kind: "batch", workspaceId: b.workspaceId, batchId: b.id, runId: b.runId }
      : { kind: "orphan" };
  }
  if (r.kind === "payout_item") {
    // Items join through their batch first (never by sender_item_id alone, S3.6.5).
    const batchId = r.payoutBatchId;
    const senderItemId = r.senderItemId;
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
    const item = senderItemId
      ? items.find((i) => i.senderItemId === senderItemId)
      : items.find((i) => r.payoutItemId && i.payoutItemId === r.payoutItemId);
    // All supplied identities must agree. An unknown PayPal item ID may bind to our pre-POST sender
    // ID, but must never redirect a delivery from an already-bound item to another sender.
    if (
      !item ||
      (r.payoutItemId && item.payoutItemId && r.payoutItemId !== item.payoutItemId) ||
      (r.payoutItemId && items.some((other) => other.id !== item.id && other.payoutItemId === r.payoutItemId))
    )
      return { kind: "orphan" };
    return { kind: "item", workspaceId: b.workspaceId, item, runId: b.runId, paypalBatchId: batchId };
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
  if (
    !row ||
    row.status === "applied" ||
    row.status === "rejected" ||
    row.paypalEventId !== args.paypalEventId
  )
    return;
  const parsed = parseWebhookEnvelope(row.raw);
  const consistent =
    parsed.ok && parsed.event.id === row.paypalEventId && parsed.event.event_type === row.eventType;
  const eventType = row.eventType;
  const typed = WebhookEventTypeSchema.safeParse(eventType);
  const verified = (row.verified ?? "fetched") as WebhookVerified;
  const resource = consistent ? resourceRefOf(parsed.event) : ({ kind: "other" } as const);
  const target = typed.success ? await resolve(deps.db, resource) : ({ kind: "orphan" } as const);
  const provenance = deps.paypal.provenance;

  if (target.kind === "orphan") {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(schema.webhookEvents)
        .set({ status: "orphan", appliedAt: null, error: "RESOURCE_MISMATCH" })
        .where(
          and(
            eq(schema.webhookEvents.id, row.id),
            ne(schema.webhookEvents.status, "applied"),
            ne(schema.webhookEvents.status, "rejected"),
          ),
        );
      await ctx.complete(tx);
    });
    return;
  }
  const scope = systemScope(target.workspaceId, ACTORS.paypalWebhook);
  const eventTypeOk = typed.success ? (typed.data as WebhookEventType) : null;
  const batchId =
    target.kind === "item" ? target.item.batchId : target.kind === "batch" ? target.batchId : null;
  let stranded = false;

  // PayPal's word first, when the rule says a GET must decide (S3.6.5). Without an item id to GET (PayPal names
  // items only in the settle GET), the event changes nothing and the batch GET decides.
  let fresh: { status: PayoutItemStatus | null; payoutItemId: string | null } | null = null;
  let batchGetDecides = false;
  const storedRuleFor = (item: ItemRow, paypalBatchId: string) =>
    storedWebhookApplyRule({
      eventType,
      verified,
      delivery: row.delivery,
      raw: row.raw,
      paypalEventId: row.paypalEventId,
      receivedAt: row.receivedAt,
      item: {
        payoutBatchId: paypalBatchId,
        payoutItemId: item.payoutItemId,
        senderItemId: item.senderItemId,
        status: item.status,
        cancelRequestedAt: item.cancelRequestedAt,
      },
    });
  if (target.kind === "item") {
    const rule = storedRuleFor(target.item, target.paypalBatchId);
    // Immediate application checks under the lock below; only an external GET needs a pre-check too.
    if (rule.action === "fresh_get_first")
      stranded = await isStrandedBatch(deps.db, target.workspaceId, target.item.batchId);
    if (rule.action === "fresh_get_first" && !stranded) {
      const id = target.item.payoutItemId ?? (resource.kind === "payout_item" ? resource.payoutItemId : null);
      if (id) {
        const got = await getPayoutItem(
          deps.paypal.core.http,
          CONTEXT,
          { payout_item_id: id },
          { priority: "background" },
        );
        if (!got.ok)
          throw classifyPayPal(new Error(`${got.status} ${got.name}`), "the payout item status check");
        // The stored body can suggest an unbound ID, but only a matching GET may bind it.
        if (
          got.body.payout_item?.sender_item_id !== target.item.senderItemId ||
          got.body.payout_batch_id !== target.paypalBatchId ||
          got.body.payout_item_id !== id
        ) {
          batchGetDecides = true;
        } else {
          fresh = { status: itemStatusOf(got.body.transaction_status), payoutItemId: id };
        }
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
    // Outbox retries can race after the first read. Recheck under the workspace lock before any
    // event/ledger effect; the same stored event is applied once even with concurrent workers.
    const [stored] = await tx
      .select({ status: schema.webhookEvents.status })
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, row.id))
      .for("update");
    if (!stored || stored.status === "applied" || stored.status === "rejected") {
      await ctx.complete(tx);
      return;
    }
    await tx
      .update(schema.webhookEvents)
      .set({
        workspaceId: target.workspaceId,
        status: "orphan",
        appliedAt: null,
        error: "NO_APPLY",
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
    const markApplied = async () => {
      await tx
        .update(schema.webhookEvents)
        .set({ status: "applied", appliedAt: deps.clock.now(), error: null })
        .where(eq(schema.webhookEvents.id, row.id));
    };
    const defer = async (reason: string) => {
      await tx.update(schema.webhookEvents).set({ error: reason }).where(eq(schema.webhookEvents.id, row.id));
    };
    // Boot records under this same workspace lock. A marker committed after resolution still wins.
    if (batchId !== null && (stranded || (await isStrandedBatch(tx, target.workspaceId, batchId)))) {
      await defer("STRANDED_BATCH");
      await ctx.complete(tx);
      return;
    }
    const at = deps.clock.now();
    if (target.kind === "item" && eventTypeOk && batchGetDecides) {
      // Nothing to GET by id yet: change nothing; the settle GET (due within 10 s, or brought forward) decides.
      await defer("SETTLE_GET_REQUIRED");
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
          // Resolution was outside this transaction. A GET or another delivery may have bound an
          // item ID meanwhile: validate the current locked identity before trusting any body field.
          if (
            item.senderItemId !== target.item.senderItemId ||
            (fresh
              ? item.payoutItemId !== null && fresh.payoutItemId !== item.payoutItemId
              : storedRuleFor(item, target.paypalBatchId).action !== "apply_now") ||
            (await itemIdTaken(
              tx,
              fresh?.payoutItemId ?? (resource.kind === "payout_item" ? resource.payoutItemId : null),
              item.id,
            ))
          ) {
            await defer("LOCKED_ITEM_MISMATCH");
            await settleGetSoon(tx, deps, target.workspaceId, item.batchId, row.paypalEventId);
            await ctx.complete(tx);
            return;
          }
          const applied = await applyItem(tx, scope, item, {
            at: deps.clock.now(),
            status,
            source: fresh ? "status_check" : "webhook",
            eventId: row.paypalEventId,
            provenance,
            actor: ACTORS.paypalWebhook,
            payoutItemId:
              fresh?.payoutItemId ?? (resource.kind === "payout_item" ? resource.payoutItemId : null),
            transactionStatus: fresh ? fresh.status : "SUCCESS",
          });
          if (
            applied.applied ||
            (await confirmsHeldStatus(tx, scope, item, {
              said: status,
              applied,
              eventType: eventTypeOk,
              verified,
            }))
          ) {
            await markApplied();
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
                payoutItemId:
                  fresh?.payoutItemId ??
                  (resource.kind === "payout_item" ? resource.payoutItemId : null) ??
                  item.payoutItemId ??
                  "",
                status,
              },
              { runId, at, actor: ACTORS.paypalWebhook },
            );
          }
          await advanceRun(tx, scope, runId, provenance);
        }
      }
    } else if (target.kind === "batch" && eventTypeOk) {
      await defer("SETTLE_GET_REQUIRED");
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
        await markApplied();
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

/**
 * Whether a verified item event that changed nothing confirms the status its item already holds, and so is the
 * event that status rests on (Proof plate 6: every item status is the forward-only fold of verified
 * `webhook.applied` entries). A status can land before PayPal's signed event for it: our cancel sets RETURNED from
 * PayPal's answer before its signed CANCELED arrives, and the settle GET can read a SUCCESS before its SUCCEEDED is
 * processed. The event confirms it when the item already holds the status the event names and the GET (or, for a
 * signed SUCCEEDED applied at once, the event) said, the event is not `dev_mock`, and no verified event of the chain
 * carries that status for the item yet. RETURNED follows our own `payout.cancel` in the chain, as plate 6 asks,
 * because only our cancel sets it. Nothing changes and no `item.updated` is written; only the ledger entry is.
 */
async function confirmsHeldStatus(
  tx: Tx,
  scope: WorkspaceScope,
  item: ItemRow,
  e: {
    /** What the fresh GET (or a signed SUCCEEDED applied at once) said. */
    said: PayoutItemStatus;
    applied: Awaited<ReturnType<typeof applyItem>>;
    eventType: WebhookEventType;
    verified: WebhookVerified;
  },
): Promise<boolean> {
  const { said, applied } = e;
  if (applied.applied || applied.reason !== "NOT_HIGHER" || e.verified === "dev_mock") return false;
  if (said !== applied.current || itemStatusOf(e.eventType) !== said) return false;
  const l = schema.ledgerEntries;
  const [rests] = await tx
    .select({ seq: l.seq })
    .from(l)
    .where(
      and(
        eq(l.workspaceId, scope.workspaceId),
        eq(l.kind, "webhook.applied"),
        sql`${l.payload}->>'resource' = 'payout_item'`,
        sql`${l.payload}->>'senderItemId' = ${item.senderItemId}`,
        sql`${l.payload}->>'status' = ${applied.current}`,
        sql`${l.payload}->>'verified' <> 'dev_mock'`,
      ),
    )
    .limit(1);
  return rests === undefined;
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
