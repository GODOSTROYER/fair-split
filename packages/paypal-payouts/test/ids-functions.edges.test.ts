// Tests that kill mutation-testing survivors (handoff T3) in the payout identifiers, the wire amounts,
// the strict batch schema and the call functions: the idempotency keys' exact edges, the parser of our
// own sender_item_ids, and the lane every PayPal call is queued in.

import type { PayPalHttp, PayPalRequest } from "@fairsplit/paypal-core";
import { describe, expect, it } from "vitest";
import {
  cancelUnclaimedPayoutItem,
  createPayoutBatch,
  getPayoutBatch,
  getPayoutItem,
  PayoutParamsError,
} from "../src/functions.js";
import {
  batchNote,
  fairSplitPayoutBatch,
  PayoutIdError,
  parseSenderItemId,
  readValueCents,
  SENDER_ITEM_ID_MAX,
  senderItemId,
} from "../src/index.js";
import { RATE_CARD_SHA256 } from "./support/fixtures.js";

describe("sender_item_id: the item idempotency key", () => {
  it("is at most 63 characters, exactly", () => {
    const memberNo = "A".repeat(40);
    const runSeq = Number.MAX_SAFE_INTEGER; // 16 digits
    const at = senderItemId({ runSeq, memberNo, rerouteNo: 1_000 });
    expect(at).toHaveLength(SENDER_ITEM_ID_MAX);
    expect(() => senderItemId({ runSeq, memberNo, rerouteNo: 10_000 })).toThrow(PayoutIdError);
  });

  it("refuses a re-route number below 1 (x0 would collide with nothing we ever wrote)", () => {
    expect(() => senderItemId({ runSeq: 37, memberNo: "M-031", rerouteNo: 0 })).toThrow(
      "A re-route number starts at 1: 0",
    );
  });

  it("names its error", () => {
    try {
      senderItemId({ runSeq: 0, memberNo: "M-031" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).name).toBe("PayoutIdError");
      expect((e as Error).message).toBe("runSeq must be a positive integer: 0");
    }
  });
});

describe("parseSenderItemId: only ids we wrote", () => {
  it("parses run 1 and re-route 1, the smallest of each", () => {
    expect(parseSenderItemId("r1-M-031")).toEqual({ runSeq: 1, rerouteNo: null, memberNo: "M-031" });
    expect(parseSenderItemId("r1x1-M-031")).toEqual({ runSeq: 1, rerouteNo: 1, memberNo: "M-031" });
  });

  it.each(["garbage", "r0-M-031", "r1x0-M-031", "r99999999999999999-M-031", "r1x99999999999999999-M-031"])(
    "refuses %s",
    (id) => {
      expect(parseSenderItemId(id)).toBeNull();
    },
  );
});

describe("batchNote and wire amounts", () => {
  it("batchNote refuses a season code that is not one", () => {
    expect(() => batchNote("2026A", RATE_CARD_SHA256)).toThrow(PayoutIdError);
    expect(batchNote("2026-A", RATE_CARD_SHA256)).toBe(
      `Fair Split 2026-A, batch ${RATE_CARD_SHA256.slice(0, 8)}`,
    );
  });

  it("readValueCents reads an amount PayPal padded with spaces", () => {
    expect(readValueCents(" 64.45 ")).toBe(6_445n);
  });
});

describe("fairSplitPayoutBatch: a repeated sender_item_id is named where it repeats", () => {
  it("reports the second item's sender_item_id as the duplicate", () => {
    const item = (id: string) => ({
      receiver: "m014@example.test",
      amount: { currency: "USD", value: "1.00" },
      sender_item_id: id,
      purpose: "GOODS",
    });
    const out = fairSplitPayoutBatch.safeParse({
      sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37", recipient_type: "EMAIL", note: "n" },
      items: [item("r37-M-014"), item("r37-M-014")],
    });
    expect(out.success).toBe(false);
    expect(out.error?.issues).toEqual([
      expect.objectContaining({ path: ["items", 1, "sender_item_id"], message: "duplicate" }),
    ]);
  });
});

describe("the call functions", () => {
  function recordingHttp() {
    const calls: PayPalRequest[] = [];
    const http = {
      request: async (req: PayPalRequest) => {
        calls.push(req);
        return { ok: true, status: 200, body: {}, debugId: null, headers: new Headers() };
      },
    } as unknown as PayPalHttp;
    return { http, calls };
  }
  const batch = {
    sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37", recipient_type: "EMAIL" as const },
    items: [{ receiver: "m014@example.test", amount: { currency: "USD", value: "64.45" } }],
  };

  it("every call goes in the live lane unless told otherwise", async () => {
    const { http, calls } = recordingHttp();
    await createPayoutBatch(http, {}, batch);
    await getPayoutBatch(
      http,
      {},
      { payout_batch_id: "5UXD2E8A7EBQJ", page: 1, page_size: 10, total_required: true },
    );
    await getPayoutItem(http, {}, { payout_item_id: "8AELMXH8UB2P8" });
    await cancelUnclaimedPayoutItem(http, {}, { payout_item_id: "8AELMXH8UB2P8" });
    expect(calls.map((c) => c.priority)).toEqual(["live", "live", "live", "live"]);
    await createPayoutBatch(http, {}, batch, { priority: "background" });
    expect(calls.at(-1)?.priority).toBe("background");
  });

  it("create refuses items without a recipient_type when the header has none", async () => {
    const { http, calls } = recordingHttp();
    const { recipient_type: _dropped, ...header } = batch.sender_batch_header;
    await expect(createPayoutBatch(http, {}, { ...batch, sender_batch_header: header })).rejects.toThrow(
      "recipient_type must be set on sender_batch_header or on every item.",
    );
    await expect(
      createPayoutBatch(http, {}, { ...batch, sender_batch_header: header }).catch((e: Error) => e.name),
    ).resolves.toBe("PayoutParamsError");
    // Set on every item instead: sent.
    await createPayoutBatch(
      http,
      {},
      {
        sender_batch_header: header,
        items: batch.items.map((i) => ({ ...i, recipient_type: "EMAIL" as const })),
      },
    );
    expect(calls).toHaveLength(1);
    expect(new PayoutParamsError("x")).toBeInstanceOf(Error);
  });
});
