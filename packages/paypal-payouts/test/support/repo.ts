import type { PayoutItemRow, PayoutsRepository, SubmittedBatch } from "../../src/index.js";

export type RepoEvent =
  | { type: "writeSubmitted"; batch: SubmittedBatch }
  | { type: "markPosted"; senderBatchId: string; payoutBatchId: string; outcome: string }
  | { type: "markRejected"; senderBatchId: string; status: number; name: string }
  | { type: "markCancelRequested"; payoutItemId: string; intent: string }
  | { type: "applyItemStatus"; payoutItemId: string; transactionStatus: string; source: string };

/** In-memory IC-04 double that logs every write in order. */
export class MemoryPayoutsRepo implements PayoutsRepository {
  readonly events: RepoEvent[] = [];
  readonly batches = new Map<
    string,
    { status: string; batch: SubmittedBatch; payoutBatchId: string | null }
  >();
  readonly items = new Map<string, PayoutItemRow>();

  constructor(items: PayoutItemRow[] = []) {
    for (const row of items) this.items.set(row.payoutItemId, { ...row });
  }

  async writeSubmitted(batch: SubmittedBatch): Promise<void> {
    this.events.push({ type: "writeSubmitted", batch });
    if (!this.batches.has(batch.senderBatchId)) {
      this.batches.set(batch.senderBatchId, { status: "SUBMITTED", batch, payoutBatchId: null });
    }
  }

  async markPosted(p: Parameters<PayoutsRepository["markPosted"]>[0]): Promise<void> {
    this.events.push({
      type: "markPosted",
      senderBatchId: p.senderBatchId,
      payoutBatchId: p.payoutBatchId,
      outcome: p.outcome,
    });
    const row = this.batches.get(p.senderBatchId);
    if (row) Object.assign(row, { status: "POSTED", payoutBatchId: p.payoutBatchId });
  }

  async markRejected(r: Parameters<PayoutsRepository["markRejected"]>[0]): Promise<void> {
    this.events.push({
      type: "markRejected",
      senderBatchId: r.senderBatchId,
      status: r.status,
      name: r.name,
    });
    const row = this.batches.get(r.senderBatchId);
    if (row) row.status = "REJECTED";
  }

  async findItem(payoutItemId: string): Promise<PayoutItemRow | null> {
    const row = this.items.get(payoutItemId);
    return row ? { ...row } : null;
  }

  async markCancelRequested(r: Parameters<PayoutsRepository["markCancelRequested"]>[0]): Promise<void> {
    this.events.push({ type: "markCancelRequested", payoutItemId: r.payoutItemId, intent: r.intent });
    const row = this.items.get(r.payoutItemId);
    if (row) Object.assign(row, { cancelRequestedAt: r.requestedAt, cancelIntent: r.intent });
  }

  async applyItemStatus(u: Parameters<PayoutsRepository["applyItemStatus"]>[0]): Promise<void> {
    this.events.push({
      type: "applyItemStatus",
      payoutItemId: u.payoutItemId,
      transactionStatus: u.transactionStatus,
      source: u.source,
    });
    const row = this.items.get(u.payoutItemId);
    if (row) row.status = u.transactionStatus;
  }

  types(): string[] {
    return this.events.map((e) => e.type);
  }
}
