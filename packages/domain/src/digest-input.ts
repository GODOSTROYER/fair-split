// The exact bytes behind the batch digest and the approval signature, without hashing. Pure, so
// the browser verifier (Proof, W-PF-01) can rebuild them and hash with its own crypto.
import type { ApprovalPayload, BatchItem, LedgerCheckpoint } from "@fairsplit/contracts";
import { jcs, jcsBytes } from "./jcs.js";

export interface BatchRun {
  runId: string;
  senderBatchId: string;
  rateCardSha256: string;
}

export interface BatchCanonical {
  runId: string;
  senderBatchId: string;
  rateCardSha256: string;
  items: BatchItem[];
  itemCount: number;
  totalCents: number;
  /** JCS of {runId, senderBatchId, rateCardSha256, items sorted by senderItemId}. */
  jcs: string;
}

/** Items sorted by senderItemId with exactly the four hashed fields. Item order on input does not matter. */
export function batchCanonical(run: BatchRun, items: readonly BatchItem[]): BatchCanonical {
  if (items.length === 0) throw new RangeError("a batch needs at least one item");
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.senderItemId)) throw new Error(`duplicate sender_item_id ${it.senderItemId}`);
    seen.add(it.senderItemId);
    if (!Number.isSafeInteger(it.amountCents) || it.amountCents <= 0) {
      throw new RangeError("item amounts must be positive cents");
    }
  }
  const sorted: BatchItem[] = [...items]
    .map((i) => ({
      senderItemId: i.senderItemId,
      receiver: i.receiver,
      amountCents: i.amountCents,
      currency: i.currency,
    }))
    .sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
  const body = {
    runId: run.runId,
    senderBatchId: run.senderBatchId,
    rateCardSha256: run.rateCardSha256,
    items: sorted,
  };
  return {
    ...body,
    itemCount: sorted.length,
    totalCents: sorted.reduce((s, i) => s + i.amountCents, 0),
    jcs: jcs(body),
  };
}

/** `rc:{rateCardSha16}`. */
export function invoiceReference(rateCardSha256: string): string {
  return `rc:${rateCardSha256.slice(0, 16)}`;
}

/**
 * JCS of `[{memberNo, lineSha256}]` sorted by member number: the preimage of the lines root that the
 * `lines.computed` ledger entry carries and Proof plate 4 recomputes.
 */
export function linesRootJcs(lines: readonly { memberNo: string; lineSha256: string }[]): string {
  const sorted = lines
    .map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }))
    .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
  return jcs(sorted);
}

/** UTF-8 bytes of the approval payload's JCS form: exactly what each approver signs. */
export function approvalBytes(payload: ApprovalPayload): Uint8Array {
  return jcsBytes(payload);
}

/** Domain separation for checkpoint signatures, so no other signed JCS can pass as one. */
export const CHECKPOINT_PURPOSE = "fairsplit.ledger.checkpoint";

/**
 * UTF-8 bytes of what the ledger key signs for a checkpoint:
 * JCS{purpose, v, keyId, runId, seq, entryHash, at}.
 */
export function checkpointBytes(c: Omit<LedgerCheckpoint, "signatureHex">): Uint8Array {
  return jcsBytes({
    purpose: CHECKPOINT_PURPOSE,
    v: c.v,
    keyId: c.keyId,
    runId: c.runId,
    seq: c.seq,
    entryHash: c.entryHash,
    at: c.at,
  });
}
