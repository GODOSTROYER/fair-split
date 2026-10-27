import {
  batchNote,
  type PayoutItemRow,
  type PayoutRunFacts,
  type PayoutsRepository,
  type PostingSnapshot,
  payPalRequestId,
  type SignedApproval,
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
  | {
      type: "voidApprovals";
      runId: string;
      nonces: string[];
      code: string;
      reason: string;
      at: string;
      /** False when the compare-and-set found the run moved on and wrote nothing. */
      applied: boolean;
    }
  | { type: "applyItemStatus"; payoutItemId: string; transactionStatus: string; source: string };

type BatchRow = {
  status: "SUBMITTED" | "POSTED" | "REJECTED";
  batch: SubmittedBatch;
  payoutBatchId: string | null;
};

/** The run states this port reads and moves (the double does not model POSTED or later). */
export type RunState = "APPROVED" | "IN_REVIEW" | "POSTING";

/** A run's facts and lines as stored; its approvals and batch rows are kept apart, as in the database. */
type PostingRow = Omit<PostingSnapshot, "approvals" | "submitted">;

interface ApprovalRow {
  approval: SignedApproval;
  voidedAt: string | null;
  voidReason: string | null;
}

const nonceOf = (approval: SignedApproval): unknown => approval?.payload?.nonce;

/**
 * In-memory IC-04 double that logs every write in order. Reads (loadPosting, loadRun, findItem,
 * findSupersedingItem) are not logged, so `events` lists exactly what a post or a cancel wrote. Like
 * the real store, it reports a written batch back as `submitted`, never overwrites the rows under a
 * sender_batch_id (a second write returns their mark), marks POSTED or REJECTED only the rows that
 * carry the given digest, and enforces UNIQUE supersedes_item_id. It keeps each run's state and its
 * approvals apart from the snapshot, so the compare-and-sets of the port contract hold: a primary
 * batch is written (APPROVED → POSTING) only while the approvals it names are live, and a void
 * (APPROVED → IN_REVIEW) touches only the approvals it names, only while they are the run's live set.
 */
export class MemoryPayoutsRepo implements PayoutsRepository {
  readonly events: RepoEvent[] = [];
  readonly batches = new Map<string, BatchRow>();
  readonly items = new Map<string, PayoutItemRow>();
  readonly postings = new Map<string, PostingRow>();
  readonly approvals = new Map<string, ApprovalRow[]>();
  readonly runStates = new Map<string, RunState>();
  readonly runs = new Map<string, PayoutRunFacts>();
  /** When earlier batches (other runs, other days) were written, for the daily cap. */
  readonly earlierPosts: string[] = [];

  constructor(seed: { items?: PayoutItemRow[]; postings?: PostingSnapshot[]; runs?: PayoutRunFacts[] } = {}) {
    for (const row of seed.items ?? []) this.items.set(row.payoutItemId, { ...row });
    for (const p of seed.postings ?? []) {
      const { approvals, submitted, ...row } = p;
      this.postings.set(p.runId, row);
      this.runs.set(p.runId, row);
      this.approvals.set(
        p.runId,
        approvals.map((approval) => ({ approval, voidedAt: null, voidReason: null })),
      );
      this.runStates.set(p.runId, submitted ? "POSTING" : "APPROVED");
      if (submitted) this.#seedSubmitted(p, submitted);
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
        approvalNonces: p.approvals.map((a) => a.payload.nonce),
        at: mark.at,
      },
    });
  }

  // ---- test controls: what other callers do to the database meanwhile (not logged) -------------

  /** The officers sign (again): the approvals are stored live and the run is APPROVED. */
  sign(runId: string, approvals: readonly SignedApproval[]): void {
    const rows = this.approvals.get(runId) ?? [];
    rows.push(...approvals.map((approval) => ({ approval, voidedAt: null, voidReason: null })));
    this.approvals.set(runId, rows);
    this.runStates.set(runId, "APPROVED");
  }

  /** The database's lines (on rail, or every member line) or holds change, as loadPosting and loadRun read them. */
  edit(runId: string, patch: Partial<Pick<PostingRow, "lines" | "memberLines" | "holds">>): void {
    const posting = this.postings.get(runId);
    const run = this.runs.get(runId);
    if (!posting && !run) throw new Error(`no run ${runId}`);
    if (posting) this.postings.set(runId, { ...posting, ...patch });
    if (run) this.runs.set(runId, { ...run, ...patch });
  }

  liveNonces(runId: string): unknown[] {
    return (this.approvals.get(runId) ?? [])
      .filter((r) => r.voidedAt === null)
      .map((r) => nonceOf(r.approval));
  }

  voidedNonces(runId: string): unknown[] {
    return (this.approvals.get(runId) ?? [])
      .filter((r) => r.voidedAt !== null)
      .map((r) => nonceOf(r.approval));
  }

  // ---- the port ---------------------------------------------------------------------------------

  async loadPosting(runId: string): Promise<PostingSnapshot | null> {
    const row = this.postings.get(runId);
    const state = this.runStates.get(runId);
    if (!row || (state !== "APPROVED" && state !== "POSTING")) return null;
    const written = [...this.batches.values()].find(
      (b) => b.batch.runId === runId && b.batch.kind === "primary",
    );
    return {
      ...row,
      spentNonces: this.#spentNonces(runId, row.spentNonces),
      approvals: (this.approvals.get(runId) ?? []).filter((r) => r.voidedAt === null).map((r) => r.approval),
      submitted: written ? { at: written.batch.at, batchSha256: written.batch.batchSha256 } : null,
    };
  }

  async loadRun(runId: string): Promise<PayoutRunFacts | null> {
    const run = this.runs.get(runId);
    return run ? { ...run, spentNonces: this.#spentNonces(runId, run.spentNonces) } : null;
  }

  /**
   * What the database holds as spent for the run: the seeded nonces and every voided approval's. A
   * seed that is not a list stands for a broken read and is handed on as it is.
   */
  #spentNonces(runId: string, seeded: readonly string[]): readonly string[] {
    if (!Array.isArray(seeded)) return seeded;
    const voided = this.voidedNonces(runId).filter((n): n is string => typeof n === "string");
    return [...new Set([...seeded, ...voided])];
  }

  async writeSubmitted(batch: SubmittedBatch): Promise<SubmittedMark | null> {
    this.events.push({ type: "writeSubmitted", batch });
    const stored = this.batches.get(batch.senderBatchId);
    // Never overwritten or merged: the rows already under this sender_batch_id answer for it.
    if (stored) return { at: stored.batch.at, batchSha256: stored.batch.batchSha256 };
    if (batch.kind === "primary") {
      // APPROVED → POSTING, compare-and-set on the state and on the approvals the service checked.
      const live = new Set(this.liveNonces(batch.runId));
      const current =
        this.runStates.get(batch.runId) === "APPROVED" &&
        batch.approvalNonces.length > 0 &&
        batch.approvalNonces.every((nonce) => live.has(nonce));
      if (!current) return null;
    }
    for (const item of batch.items) {
      if (item.supersedesItemId && (await this.findSupersedingItem(item.supersedesItemId))) {
        throw new Error(`UNIQUE violation: supersedes_item_id ${item.supersedesItemId}`);
      }
    }
    this.batches.set(batch.senderBatchId, { status: "SUBMITTED", batch, payoutBatchId: null });
    if (batch.kind === "primary") this.runStates.set(batch.runId, "POSTING");
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

  /**
   * One transaction: only while the run is APPROVED and every live approval of the run is one the
   * call names, void those and move the run to IN_REVIEW; otherwise write nothing.
   */
  async voidApprovals(v: Parameters<PayoutsRepository["voidApprovals"]>[0]): Promise<void> {
    const named = new Set<unknown>(v.nonces);
    const live = (this.approvals.get(v.runId) ?? []).filter((r) => r.voidedAt === null);
    const applied =
      this.runStates.get(v.runId) === "APPROVED" && live.every((r) => named.has(nonceOf(r.approval)));
    this.events.push({
      type: "voidApprovals",
      runId: v.runId,
      nonces: [...v.nonces],
      code: v.code,
      reason: v.reason,
      at: v.at,
      applied,
    });
    if (!applied) return;
    for (const row of live) {
      if (named.has(nonceOf(row.approval))) Object.assign(row, { voidedAt: v.at, voidReason: v.reason });
    }
    this.runStates.set(v.runId, "IN_REVIEW");
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

/**
 * The port as one executor sees it when the database moves on between its read and its writes:
 * `loadPosting` returns what it read, after `meanwhile` (another executor, the officers) has run.
 * Every other call goes to `repo` itself, so writes see the database as it is now.
 */
export function staleAfterRead(repo: MemoryPayoutsRepo, meanwhile: () => Promise<void>): PayoutsRepository {
  return new Proxy(repo, {
    get(target, prop) {
      if (prop === "loadPosting") {
        return async (runId: string) => {
          const read = await target.loadPosting(runId);
          await meanwhile();
          return read;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
