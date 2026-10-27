import {
  batchNote,
  type PayoutItemRow,
  type PayoutRunFacts,
  type PayoutsRepository,
  type PostingSnapshot,
  payPalRequestId,
  type SubmittedBatch,
  type SubmittedMark,
  type SupersedingItem,
  senderBatchId,
  senderItemId,
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
 * the real store, it reports a written batch back as `submitted`, never overwrites the rows under a
 * sender_batch_id (a second write returns their mark), marks POSTED or REJECTED only the rows that
 * carry the given digest, and enforces UNIQUE supersedes_item_id.
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
      if (p.submitted) this.#seedSubmitted(p, p.submitted);
    }
    for (const r of seed.runs ?? []) this.runs.set(r.runId, r);
  }

  /** The rows an earlier attempt wrote for a seeded snapshot that says so (not logged). */
  #seedSubmitted(p: PostingSnapshot, mark: SubmittedMark): void {
    const sbid = senderBatchId(p);
    const items = p.lines.map((line) => ({
      ...line,
      senderItemId: senderItemId({ runSeq: p.runSeq, memberNo: line.memberNo }),
      supersedesItemId: null,
    }));
    this.batches.set(sbid, {
      status: "SUBMITTED",
      payoutBatchId: null,
      batch: {
        runId: p.runId,
        kind: "primary",
        senderBatchId: sbid,
        requestId: payPalRequestId(sbid),
        batchSha256: mark.batchSha256,
        note: batchNote(p.seasonCode, mark.batchSha256),
        totalCents: items.reduce((sum, item) => sum + item.amountCents, 0n),
        currency: "USD",
        items,
        at: mark.at,
      },
    });
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

  async writeSubmitted(batch: SubmittedBatch): Promise<SubmittedMark> {
    this.events.push({ type: "writeSubmitted", batch });
    const stored = this.batches.get(batch.senderBatchId);
    // Never overwritten or merged: the rows already under this sender_batch_id answer for it.
    if (stored) return { at: stored.batch.at, batchSha256: stored.batch.batchSha256 };
    for (const item of batch.items) {
      if (item.supersedesItemId && (await this.findSupersedingItem(item.supersedesItemId))) {
        throw new Error(`UNIQUE violation: supersedes_item_id ${item.supersedesItemId}`);
      }
    }
    this.batches.set(batch.senderBatchId, { status: "SUBMITTED", batch, payoutBatchId: null });
    return { at: batch.at, batchSha256: batch.batchSha256 };
  }

  /** UPDATE … WHERE sender_batch_id = $1 AND batch_sha256 = $2; no such row writes nothing and rejects. */
  #compareAndSet(senderBatchId: string, batchSha256: string): BatchRow {
    const row = this.batches.get(senderBatchId);
    if (!row) throw new Error(`${senderBatchId} holds no batch`);
    if (row.batch.batchSha256 !== batchSha256) {
      throw new Error(`${senderBatchId} holds another batch (${row.batch.batchSha256.slice(0, 8)})`);
    }
    return row;
  }

  async markPosted(p: Parameters<PayoutsRepository["markPosted"]>[0]): Promise<void> {
    const row = this.#compareAndSet(p.senderBatchId, p.batchSha256);
    this.events.push({
      type: "markPosted",
      senderBatchId: p.senderBatchId,
      payoutBatchId: p.payoutBatchId,
      outcome: p.outcome,
    });
    Object.assign(row, { status: "POSTED", payoutBatchId: p.payoutBatchId });
  }

  async markRejected(r: Parameters<PayoutsRepository["markRejected"]>[0]): Promise<void> {
    const row = this.#compareAndSet(r.senderBatchId, r.batchSha256);
    this.events.push({
      type: "markRejected",
      senderBatchId: r.senderBatchId,
      status: r.status,
      name: r.name,
    });
    row.status = "REJECTED";
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
