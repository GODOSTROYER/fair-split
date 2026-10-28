/**
 * WS-CORE's digest functions (register §8 as amended by the approved plan), copied from @fairsplit/domain byte for
 * byte, because the package cannot reach the app: register §6 keeps `domain` out of UI code (dependency-cruiser
 * `layer-ui`), and its hashing module (`canon.ts`) is node:crypto, which React Native does not have.
 *
 * Every declaration below is the package's own text (the file it comes from is named above it), and
 * `domain-core.parity.test.ts` fails the moment one drifts from packages/domain/src: it compares each declaration with
 * the package's source, checks `sha256Hex` against node:crypto (what the package hashes with), and recomputes the seed
 * snapshot's batch hash, all 64 line hashes and the lines digest (what the package produced). `sha256Hex` alone is the
 * app's: @noble/hashes in place of node:crypto, the same bytes in and the same lowercase hex out.
 */
import type { ApprovalPayload, BatchDigest, BatchItem } from "@fairsplit/contracts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import canonicalize from "canonicalize";

/* ------------------------------------------------------------------ jcs.ts */

/** JCS string of a JSON value. Throws on values JSON cannot carry (bigint, undefined, NaN). */
export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("value is not JSON-serialisable");
  return out;
}

/** UTF-8 bytes of the JCS form (what an approver signs). */
export function jcsBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(jcs(value));
}

/* ------------------------------------------------------------------ canon.ts (sha256 from @noble/hashes) */

/** Lowercase hex sha256. Strings are hashed as their UTF-8 bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

/** sha256 of the JCS form of a value. */
export function jcsSha256(value: unknown): string {
  return sha256Hex(jcs(value));
}

/* ------------------------------------------------------------------ digest-input.ts */

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

/* ------------------------------------------------------------------ batch.ts */

/**
 * batchSha256 = sha256 of JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId:
 * [{senderItemId, receiver, amountCents, currency}]}. Item order on input does not matter.
 */
export function batchDigest(run: BatchRun, items: readonly BatchItem[]): BatchDigest {
  const c = batchCanonical(run, items);
  return { ...c, batchSha256: sha256Hex(c.jcs) };
}

/* ------------------------------------------------------------------ approval.ts */

/**
 * The `linesDigest` both approvers sign: the lines root over every member line of the run, on and off
 * rail, sha256(JCS([{memberNo, lineSha256}] sorted by memberNo)). It is the root the run's
 * `lines.computed` ledger entry carries and Proof plate 4 recomputes, so a cash line changed after
 * signing no longer matches either key. One line per member; at least one line.
 */
export function linesDigest(lines: readonly { memberNo: string; lineSha256: string }[]): string {
  if (lines.length === 0) throw new RangeError("linesDigest needs the run's lines");
  if (new Set(lines.map((l) => l.memberNo)).size !== lines.length) {
    throw new RangeError("linesDigest needs one line per member");
  }
  return sha256Hex(linesRootJcs(lines));
}

/* ------------------------------------------------------------------ ids.ts */

/** The parts of a sender_item_id, or null when it is not one. */
export function parseSenderItemId(
  id: string,
): { runSeq: number; rerouteN: number | null; memberNo: string } | null {
  const m = /^r(\d+)(?:x(\d+))?-(M-\d{3})$/.exec(id);
  if (!m) return null;
  return {
    runSeq: Number(m[1]),
    rerouteN: m[2] === undefined ? null : Number(m[2]),
    memberNo: m[3] as string,
  };
}
