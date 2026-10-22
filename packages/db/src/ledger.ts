/**
 * Attribution ledger (architecture §12, S3.12): one hash chain per workspace.
 *
 *   entry_hash = sha256(prev_hash ‖ JCS({seq, kind, actorKind, actorId, impersonatedBy, payload, at}))
 *
 * The genesis prev_hash is 64 zeros. There is one writer per workspace: `append` takes the workspace log lock,
 * reads `ledger_heads`, and inserts seq = head + 1; the SQL trigger re-checks the link and advances the head in
 * the same transaction, so a fork is impossible even from buggy callers (LEDGER_FORK). `verifyChain` recomputes
 * every hash from the stored rows.
 */
import { asc, eq, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { GENESIS_HASH, ledgerEntryHash } from "./_shims/domain.js";
import type { DbOrTx, Tx } from "./client.js";
import { lockWorkspaceLog } from "./events.js";
import { type JsonValue, toJsonObject } from "./json.js";
import { ledgerEntries, ledgerHeads } from "./schema/index.js";
import type { Actor, WorkspaceScope } from "./scope.js";

export interface LedgerAppend {
  /** e.g. ratification, row.accepted, hold.raised, approval.signed, payout.submitting, webhook.applied, flag.flipped, agent.tool */
  kind: string;
  /** a JSON object (bigint → decimal string, Date → ISO) */
  payload: Record<string, unknown>;
  /** indexes the entry for a run's proof segment; also put runId in the payload to bind it into the hash */
  runId?: string | null;
  /** override the actor (defaults to the scope's) */
  actor?: Actor;
  /** defaults to now; truncated to whole milliseconds, which is what the hash covers */
  at?: Date;
}

export interface LedgerEntry {
  id: string;
  workspaceId: string;
  seq: number;
  kind: string;
  actorKind: string;
  actorId: string;
  impersonatedBy: string | null;
  payload: { [key: string]: JsonValue };
  at: Date;
  prevHash: string;
  entryHash: string;
  runId: string | null;
}

export interface LedgerHead {
  seq: number;
  entryHash: string;
}

export async function ledgerHead(db: DbOrTx, workspaceId: string): Promise<LedgerHead> {
  const [h] = await db
    .select({ seq: ledgerHeads.seq, entryHash: ledgerHeads.entryHash })
    .from(ledgerHeads)
    .where(eq(ledgerHeads.workspaceId, workspaceId));
  return h ?? { seq: 0, entryHash: GENESIS_HASH };
}

export async function appendLedger(
  db: DbOrTx,
  scope: WorkspaceScope,
  entry: LedgerAppend,
): Promise<LedgerEntry> {
  if (!(db instanceof PgTransaction)) return db.transaction((tx) => appendLedger(tx, scope, entry));
  const tx = db as Tx;
  const actor = entry.actor ?? scope.actor;
  const at = new Date(Math.floor((entry.at ?? new Date()).getTime()));
  const payload = toJsonObject(entry.payload, `${entry.kind}.payload`);
  await lockWorkspaceLog(tx, scope.workspaceId);
  const head = await ledgerHead(tx, scope.workspaceId);
  const seq = head.seq + 1;
  const impersonatedBy = actor.impersonatedBy ?? null;
  const entryHash = ledgerEntryHash(head.entryHash, {
    seq,
    kind: entry.kind,
    actorKind: actor.kind,
    actorId: actor.id,
    impersonatedBy,
    payload,
    at: at.toISOString(),
  });
  const [row] = await tx
    .insert(ledgerEntries)
    .values({
      workspaceId: scope.workspaceId,
      seq,
      kind: entry.kind,
      actorKind: actor.kind,
      actorId: actor.id,
      impersonatedBy,
      payload,
      at,
      prevHash: head.entryHash,
      entryHash,
      runId: entry.runId ?? null,
    })
    .returning();
  if (!row) throw new Error("ledger.append: insert returned no row");
  return row as LedgerEntry;
}

export type ChainVerdict =
  | { ok: true; count: number; head: LedgerHead }
  | {
      ok: false;
      seq: number;
      reason: "SEQ_GAP" | "PREV_HASH_MISMATCH" | "HASH_MISMATCH" | "HEAD_MISMATCH";
      detail: string;
    };

/** Pure check over rows in seq order (the same rule the browser's Verify button and verify-proof apply). */
export function verifyEntries(
  rows: readonly Pick<
    LedgerEntry,
    "seq" | "kind" | "actorKind" | "actorId" | "impersonatedBy" | "payload" | "at" | "prevHash" | "entryHash"
  >[],
  opts: { fromSeq?: number; prevHash?: string } = {},
): ChainVerdict {
  let expectedSeq = opts.fromSeq ?? 1;
  let prev = opts.prevHash ?? GENESIS_HASH;
  for (const r of rows) {
    if (r.seq !== expectedSeq) {
      return {
        ok: false,
        seq: r.seq,
        reason: "SEQ_GAP",
        detail: `expected seq ${expectedSeq}, found ${r.seq}`,
      };
    }
    if (r.prevHash !== prev) {
      return {
        ok: false,
        seq: r.seq,
        reason: "PREV_HASH_MISMATCH",
        detail: `prev_hash does not match entry ${r.seq - 1}`,
      };
    }
    const recomputed = ledgerEntryHash(prev, {
      seq: r.seq,
      kind: r.kind,
      actorKind: r.actorKind,
      actorId: r.actorId,
      impersonatedBy: r.impersonatedBy,
      payload: r.payload,
      at: r.at.toISOString(),
    });
    if (recomputed !== r.entryHash) {
      return {
        ok: false,
        seq: r.seq,
        reason: "HASH_MISMATCH",
        detail: `entry ${r.seq} does not hash to its entry_hash`,
      };
    }
    prev = r.entryHash;
    expectedSeq++;
  }
  return { ok: true, count: rows.length, head: { seq: expectedSeq - 1, entryHash: prev } };
}

/** Recomputes a workspace's whole chain from the database and checks it ends at ledger_heads. */
export async function verifyChain(
  db: DbOrTx,
  workspaceId: string,
  opts: { batchSize?: number } = {},
): Promise<ChainVerdict> {
  const batch = opts.batchSize ?? 1000;
  let fromSeq = 1;
  let prevHash = GENESIS_HASH;
  let count = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(sql`${ledgerEntries.workspaceId} = ${workspaceId} and ${ledgerEntries.seq} >= ${fromSeq}`)
      .orderBy(asc(ledgerEntries.seq))
      .limit(batch);
    const verdict = verifyEntries(rows as LedgerEntry[], { fromSeq, prevHash });
    if (!verdict.ok) return verdict;
    count += verdict.count;
    prevHash = verdict.head.entryHash;
    fromSeq = verdict.head.seq + 1;
    if (rows.length < batch) break;
  }
  const head = await ledgerHead(db, workspaceId);
  if (head.seq !== fromSeq - 1 || head.entryHash !== prevHash) {
    return {
      ok: false,
      seq: head.seq,
      reason: "HEAD_MISMATCH",
      detail: `head is seq ${head.seq} but the chain ends at seq ${fromSeq - 1}`,
    };
  }
  return { ok: true, count, head };
}

/** Rows of one run's proof segment, in chain order. */
export async function ledgerSegment(db: DbOrTx, workspaceId: string, runId: string): Promise<LedgerEntry[]> {
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(sql`${ledgerEntries.workspaceId} = ${workspaceId} and ${ledgerEntries.runId} = ${runId}`)
    .orderBy(asc(ledgerEntries.seq));
  return rows as LedgerEntry[];
}

export const ledger = {
  append: appendLedger,
  head: ledgerHead,
  verifyChain,
  verifyEntries,
  segment: ledgerSegment,
};
