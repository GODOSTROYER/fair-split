// Reference batchSha256 per register §8, for tests only (the real one is IC-02 in @fairsplit/domain):
// sha256 of JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId:
// [{senderItemId, receiver, amountCents, currency}]}. JCS has no bigint, so cents go as numbers.

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { BatchDigestFn } from "../../src/index.js";

export const referenceBatchDigest: BatchDigestFn = (run, items) => {
  const jcs = canonicalize({
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
  });
  if (jcs === undefined) throw new Error("not canonicalizable");
  return createHash("sha256").update(jcs, "utf8").digest("hex");
};
