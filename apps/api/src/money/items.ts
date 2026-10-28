// One forward-only `item.updated` (C-05): a payout item status applies only if it outranks the current one, and
// RETURNED only after our own cancel (register §7, IC-02 `fsm.item.apply`). The write is a compare-and-set on
// the status we read (the SQL rank trigger guards it too); the member line follows the S3.5 table along the
// line machine's edges, with every move an IC-01 event in the same transaction.
import {
  type MemberLineState,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  type Provenance,
} from "@fairsplit/contracts";
import { type Actor, type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { itemMachine, lineMachine } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import { emit } from "../runs/events.js";
import { cause, moveLine } from "../runs/machine.js";

export type ItemRow = typeof schema.payoutItems.$inferSelect;

export type ItemSource = "webhook" | "status_check" | "post_response" | "cancel";

export interface ApplyItem {
  status: PayoutItemStatus;
  source: ItemSource;
  eventId: string | null;
  provenance: Provenance;
  actor: Actor;
  payoutItemId?: string | null;
  transactionStatus?: string | null;
  feeCents?: number | null;
  errors?: unknown;
}

export type ApplyResult =
  | { applied: true; from: PayoutItemStatus; to: PayoutItemStatus; line: MemberLineState | null }
  | { applied: false; reason: "NOT_HIGHER" | "RETURNED_WITHOUT_CANCEL" | "STALE"; current: PayoutItemStatus };

/** The line's path to the state an item status implies (SUBMITTED steps through PAYPAL_PENDING). */
export function linePath(from: MemberLineState, target: MemberLineState): MemberLineState[] {
  if (from === target) return [];
  if (lineMachine.canTransition(from, target)) return [target];
  if (from === "SUBMITTED" && lineMachine.canTransition("PAYPAL_PENDING", target))
    return ["PAYPAL_PENDING", target];
  if (from === "LOCKED") {
    if (target === "SUBMITTED") return ["SUBMITTED"];
    const rest = linePath("SUBMITTED", target);
    return rest.length > 0 ? ["SUBMITTED", ...rest] : [];
  }
  return [];
}

export async function applyItem(
  tx: DbOrTx,
  scope: WorkspaceScope,
  item: ItemRow,
  a: ApplyItem,
): Promise<ApplyResult> {
  const current = item.status as PayoutItemStatus;
  const decision = itemMachine.apply(current, a.status, { cancelRequested: item.cancelRequestedAt !== null });
  // PayPal echoes PENDING for a just-posted item (SUBMITTED, rank 0): that is a climb, applied normally.
  if (!decision.applied) return { applied: false, reason: decision.reason, current };
  const t = schema.payoutItems;
  const [row] = await tx
    .update(t)
    .set({
      status: a.status,
      statusRank: PAYOUT_ITEM_RANK[a.status],
      ...(a.payoutItemId ? { payoutItemId: a.payoutItemId } : {}),
      ...(a.transactionStatus !== undefined ? { transactionStatus: a.transactionStatus } : {}),
      ...(a.feeCents !== undefined && a.feeCents !== null
        ? { feeCents: BigInt(a.feeCents), feeCurrency: "USD" }
        : {}),
      ...(a.errors !== undefined ? { errors: a.errors } : {}),
    })
    .where(and(eq(t.workspaceId, scope.workspaceId), eq(t.id, item.id), eq(t.status, current)))
    .returning();
  if (!row) return { applied: false, reason: "STALE", current };

  const [line] = await tx
    .select({ line: schema.memberLines, memberNo: schema.members.memberNo })
    .from(schema.memberLines)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
    .where(
      and(eq(schema.memberLines.workspaceId, scope.workspaceId), eq(schema.memberLines.id, item.lineId)),
    );
  const memberNo = line?.memberNo ?? "M-000";
  await emit(
    tx,
    scope,
    "item.updated",
    {
      itemId: row.id,
      senderItemId: row.senderItemId,
      memberNo,
      payoutItemId: row.payoutItemId,
      from: current,
      to: a.status,
      rank: PAYOUT_ITEM_RANK[a.status],
      source: a.source,
      eventId: a.eventId,
    },
    { runId: line?.line.runId ?? null, lineId: item.lineId, provenance: a.provenance, actor: a.actor },
  );
  if (!line) return { applied: true, from: current, to: a.status, line: null };
  let state = line.line.state as MemberLineState;
  let version = line.line.version;
  for (const next of linePath(state, itemMachine.toLineState(a.status))) {
    const moved = await moveLine(tx, scope, {
      id: line.line.id,
      memberNo,
      runId: line.line.runId,
      from: state,
      to: next,
      version,
      cause: cause(`ITEM_${a.status}`, a.eventId ?? row.payoutItemId),
      provenance: a.provenance,
      actor: a.actor,
    });
    state = moved.state as MemberLineState;
    version = moved.version;
  }
  return { applied: true, from: current, to: a.status, line: state };
}

/** PayPal's transaction_status (or an event name) as one of our statuses, or null when unknown. */
export function itemStatusOf(raw: unknown): PayoutItemStatus | null {
  return typeof raw === "string" ? itemMachine.fromEvent(raw.toUpperCase()) : null;
}
