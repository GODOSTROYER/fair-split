import type {
  PayoutItemRow,
  PayoutRunFacts,
  PayoutsRepository,
  PostingSnapshot,
  SubmittedBatch,
  SupersedingItem,
} from "../../src/index.js";

export type RepoEvent =
  | { type: "writeSubmitted"; batch: SubmittedBatch }
  | { type: "markPosted"; senderBatchId: string; payoutBatchId: string; outcome: string }
  | { type: "markRejected"; senderBatchId: string; status: number; name: string }
  | { type: "markCancelRequested"; payoutItemId: string; intent: string; by: string }
  | { type: "applyItemStatus"; payoutItemId: string; transactionStatus: string; source: string };

type BatchRow = {
  status: "SUBMITTED" | "POSTED" | "REJECTED";
  batch: SubmittedBatch;
  payoutBatchId: string | null;
};

/**
 * In-memory IC-04 double that logs every write in order. Reads (loadPosting, loadRun, findItem,
 * findSupersedingItem) are not logged, so `events` lists exactly what a post or a cancel wrote. Like
 * the real store, it reports a written batch back as `submitted` and enforces UNIQUE
 * supersedes_item_id.
 */
export class MemoryPayoutsRepo implements PayoutsRepository {
  readonly events: RepoEvent[] = [];
  readonly batches = new Map<string, BatchRow>();
  readonly items = new Map<string, PayoutItemRow>();
  readonly postings = new Map<string, PostingSnapshot>();
  readonly runs = new Map<string, PayoutRunFacts>();
  /** When earlier batches (other runs, other days) were written, for the daily cap. */
  readonly earlierPosts: string[] = [];

  constructor(seed: { items?: PayoutItemRow[]; postings?: PostingSnapshot[]; runs?: PayoutRunFacts[] } = {}) {
    for (const row of seed.items ?? []) this.items.set(row.payoutItemId, { ...row });
    for (const p of seed.postings ?? []) {
      this.postings.set(p.runId, p);
      this.runs.set(p.runId, p);
    }
    for (const r of seed.runs ?? []) this.runs.set(r.runId, r);
  }

  async loadPosting(runId: string): Promise<PostingSnapshot | null> {
    const base = this.postings.get(runId);
    if (!base) return null;
    const written = [...this.batches.values()].find(
      (b) => b.batch.runId === runId && b.batch.kind === "primary",
    );
    return written
      ? { ...base, submitted: { at: written.batch.at, batchSha256: written.batch.batchSha256 } }
      : { ...base };
  }

  async loadRun(runId: string): Promise<PayoutRunFacts | null> {
    return this.runs.get(runId) ?? null;
  }

  async writeSubmitted(batch: SubmittedBatch): Promise<void> {
    this.events.push({ type: "writeSubmitted", batch });
    if (this.batches.has(batch.senderBatchId)) return; // idempotent on sender_batch_id
    for (const item of batch.items) {
      if (item.supersedesItemId && (await this.findSupersedingItem(item.supersedesItemId))) {
        throw new Error(`UNIQUE violation: supersedes_item_id ${item.supersedesItemId}`);
      }
    }
    this.batches.set(batch.senderBatchId, { status: "SUBMITTED", batch, payoutBatchId: null });
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

  async findSupersedingItem(payoutItemId: string): Promise<SupersedingItem | null> {
    for (const { status, batch } of this.batches.values()) {
      const item = batch.items.find((i) => i.supersedesItemId === payoutItemId);
      if (item) {
        return {
          senderBatchId: batch.senderBatchId,
          senderItemId: item.senderItemId,
          receiver: item.receiver,
          amountCents: item.amountCents,
          batchState: status,
          submitted: { at: batch.at, batchSha256: batch.batchSha256 },
        };
      }
    }
    return null;
  }

  async markCancelRequested(r: Parameters<PayoutsRepository["markCancelRequested"]>[0]): Promise<void> {
    this.events.push({
      type: "markCancelRequested",
      payoutItemId: r.payoutItemId,
      intent: r.intent,
      by: `${r.by.kind}:${r.by.id}`,
    });
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

  /** What WS-DATA's count returns: batches written as SUBMITTED in the 24 h before `now`. */
  async postsInLast24h(now: Date): Promise<number> {
    const end = now.getTime();
    const start = end - 24 * 60 * 60 * 1000;
    const written = [...this.batches.values()].map((b) => b.batch.at);
    return [...this.earlierPosts, ...written].filter((at) => {
      const t = Date.parse(at);
      return t > start && t <= end;
    }).length;
  }
}
