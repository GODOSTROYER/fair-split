// Reference IC-02 digests, for tests only (the real ones are WS-CORE's, in @fairsplit/domain). JCS has
// no bigint, so cents go as numbers.
//
// batchSha256 (register §8): sha256 of JCS{runId, senderBatchId, rateCardSha256, items sorted by
// senderItemId: [{senderItemId, receiver, amountCents, currency}]}.
//
// linesDigest (the approved plan's amendment to register §8; WS-CORE `linesDigest`): sha256 of
// JCS([{memberNo, lineSha256}] sorted by memberNo) over every member line of the run, on and off rail,
// so both keys bind the cash lines too.

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { BatchDigestFn, MemberLineHash } from "../../src/index.js";

const sha256 = (jcs: string | undefined): string => {
  if (jcs === undefined) throw new Error("not canonicalizable");
  return createHash("sha256").update(jcs, "utf8").digest("hex");
};

export const referenceBatchDigest: BatchDigestFn = (run, items) =>
  sha256(
    canonicalize({
      runId: run.runId,
      senderBatchId: run.senderBatchId,
      rateCardSha256: run.rateCardSha256,
      items: [...items]
        .sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0))
        .map((i) => ({
          senderItemId: i.senderItemId,
          receiver: i.receiver,
          amountCents: Number(i.amountCents),
          currency: i.currency,
        })),
    }),
  );

/** Like WS-CORE's `linesDigest`, it refuses no lines and a member listed twice (RangeError). */
export const referenceLinesDigest = (lines: readonly MemberLineHash[]): string => {
  if (lines.length === 0) throw new RangeError("linesDigest needs the run's lines");
  if (new Set(lines.map((l) => l.memberNo)).size !== lines.length) {
    throw new RangeError("linesDigest needs one line per member");
  }
  return sha256(
    canonicalize(
      lines
        .map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }))
        .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0)),
    ),
  );
};
