// Register §8 payout identifiers. All are derived; none is ever typed.

import { createHash } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SEASON_CODE = /^(\d{4})-([A-Z])$/;
const MEMBER_NO = /^[A-Za-z0-9-]{1,40}$/;
/** PayPal limits (payments_payouts_batch_v1.json, PR #107). */
export const SENDER_BATCH_ID_MAX = 256;
export const SENDER_ITEM_ID_MAX = 63;

export class PayoutIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutIdError";
  }
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new PayoutIdError(message);
}

function checkRunSeq(runSeq: number): void {
  check(Number.isSafeInteger(runSeq) && runSeq > 0, `runSeq must be a positive integer: ${runSeq}`);
}

function checkReroute(rerouteNo: number | undefined): void {
  if (rerouteNo !== undefined) {
    check(Number.isSafeInteger(rerouteNo) && rerouteNo > 0, `A re-route number starts at 1: ${rerouteNo}`);
  }
}

export function assertSha256(sha: string, what = "digest"): void {
  check(SHA256_HEX.test(sha), `${what} must be 64 lowercase hex characters`);
}

/** "2026-A" → "2026A" (register §2: Season 2026-A, ID code 2026A). */
export function seasonIdCode(seasonCode: string): string {
  const m = SEASON_CODE.exec(seasonCode);
  check(m !== null, `Season code must look like 2026-A: ${JSON.stringify(seasonCode)}`);
  return `${m[1]}${m[2]}`;
}

/** The first 8 hex digits of the rate card's sha256. */
export function rc8(rateCardSha256: string): string {
  assertSha256(rateCardSha256, "rateCardSha256");
  return rateCardSha256.slice(0, 8);
}

/** `{season}-{rc8}-r{runSeq}`, e.g. `2026A-7f3a91c2-r37`; a re-route adds `-x{n}`. */
export function senderBatchId(spec: {
  seasonCode: string;
  rateCardSha256: string;
  runSeq: number;
  rerouteNo?: number;
}): string {
  checkRunSeq(spec.runSeq);
  checkReroute(spec.rerouteNo);
  const base = `${seasonIdCode(spec.seasonCode)}-${rc8(spec.rateCardSha256)}-r${spec.runSeq}`;
  const id = spec.rerouteNo === undefined ? base : `${base}-x${spec.rerouteNo}`;
  check(id.length <= SENDER_BATCH_ID_MAX, "sender_batch_id too long");
  return id;
}

/** `r{runSeq}-{memberNo}`, e.g. `r37-M-014`; a re-route uses `r{runSeq}x{n}-{memberNo}`. */
export function senderItemId(spec: { runSeq: number; memberNo: string; rerouteNo?: number }): string {
  checkRunSeq(spec.runSeq);
  checkReroute(spec.rerouteNo);
  check(MEMBER_NO.test(spec.memberNo), `Not a member number: ${JSON.stringify(spec.memberNo)}`);
  const id =
    spec.rerouteNo === undefined
      ? `r${spec.runSeq}-${spec.memberNo}`
      : `r${spec.runSeq}x${spec.rerouteNo}-${spec.memberNo}`;
  check(id.length <= SENDER_ITEM_ID_MAX, `sender_item_id over ${SENDER_ITEM_ID_MAX} characters: ${id}`);
  return id;
}

/** PayPal-Request-Id = sha256(sender_batch_id), lowercase hex. */
export function payPalRequestId(senderBatchIdValue: string): string {
  return createHash("sha256").update(senderBatchIdValue, "utf8").digest("hex");
}

/** "Fair Split 2026-A, batch {digest8}" (the batch digest's first 8 hex digits). */
export function batchNote(seasonCode: string, batchSha256: string): string {
  seasonIdCode(seasonCode);
  assertSha256(batchSha256, "batchSha256");
  return `Fair Split ${seasonCode}, batch ${batchSha256.slice(0, 8)}`;
}
