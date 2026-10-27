// A PayPal that remembers every batch it created, keyed by sender_batch_id as the real one is for 30
// days (PR #107's sandbox probe): a second POST under a sender_batch_id it already holds gets the
// "already exists" 400 with a HATEOAS link to the first batch, and that batch's GET lists the items
// the FIRST post carried. Tests that race posts read from `held` what PayPal holds, and so what it
// would pay.

import { duplicateBatch, paypalError } from "./fixtures.js";
import { onGet, onPost, paypalJson } from "./msw.js";

interface PostedItem {
  receiver: string;
  amount: { currency: string; value: string };
  sender_item_id: string;
  purpose?: string;
}

interface PostedBatch {
  sender_batch_header: { sender_batch_id: string; recipient_type?: string; note?: string };
  items: PostedItem[];
}

export interface HeldBatch {
  payoutBatchId: string;
  body: PostedBatch;
}

export function payPalLedger() {
  const held = new Map<string, HeldBatch>();
  onPost("/v1/payments/payouts", (req) => {
    const body = req.body as PostedBatch;
    const sbid = body.sender_batch_header.sender_batch_id;
    const first = held.get(sbid);
    if (first) return paypalJson(duplicateBatch(first.payoutBatchId), 400, "dbg-dup");
    const payoutBatchId = `LEDGER${String(held.size + 1).padStart(4, "0")}`;
    held.set(sbid, { payoutBatchId, body });
    return paypalJson(
      {
        batch_header: {
          sender_batch_header: { sender_batch_id: sbid, recipient_type: "EMAIL" },
          payout_batch_id: payoutBatchId,
          batch_status: "PENDING",
        },
      },
      201,
      "dbg-201",
    );
  });
  onGet("/v1/payments/payouts/:id", (_req, params) => {
    const batch = [...held.values()].find((b) => b.payoutBatchId === params.id);
    if (!batch) {
      return paypalJson(paypalError("INVALID_RESOURCE_ID", "Requested resource ID was not found."), 404);
    }
    return paypalJson({
      total_items: batch.body.items.length,
      total_pages: 1,
      batch_header: {
        payout_batch_id: batch.payoutBatchId,
        batch_status: "PENDING",
        sender_batch_header: batch.body.sender_batch_header,
      },
      items: batch.body.items.map((item, i) => ({
        payout_item_id: `${batch.payoutBatchId}I${i}`,
        transaction_status: "PENDING",
        payout_batch_id: batch.payoutBatchId,
        payout_item: { recipient_type: "EMAIL", ...item },
      })),
    });
  });
  return {
    held,
    /** Every item PayPal holds, as `receiver amount sender_item_id`. */
    paid: () =>
      [...held.values()].flatMap((b) =>
        b.body.items.map((i) => `${i.receiver} ${i.amount.value} ${i.sender_item_id}`),
      ),
  };
}
