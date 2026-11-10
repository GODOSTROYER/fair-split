import type { DbOrTx } from "@fairsplit/db";
import { expect, it } from "vitest";
import type { PayPalRail } from "./mode.js";
import { replayRail } from "./replay.js";

it("inv.i8.replay-invoice: never exposes the source run payer link for this invoice", async () => {
  const rows = [
    {
      inv: {
        invoiceNumber: "FS-2026A-40",
        amountCents: 1234n,
        createdAtPaypal: new Date("2026-11-01"),
        paymentRecordedAt: null,
        sentAt: new Date("2026-11-01"),
      },
      rateCardSha256: "a".repeat(64),
    },
  ];
  const db = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => rows }) }) }),
  } as unknown as DbOrTx;
  const rail = replayRail({ core: {}, describe: () => "test" } as unknown as PayPalRail, {
    db,
    now: () => new Date("2026-11-01"),
    businessEmail: "business@example.com",
    payerEmail: "payer@example.com",
    unclaimedReceiver: null,
    source: {
      kind: "showcase",
      runSlug: "2026A-r37",
      recordedOn: "2026-11-01",
      invoiceId: "INV2-SIM-SOURCE",
      payerViewUrl: "https://www.sandbox.paypal.com/invoice/p/INV2-SIM-SOURCE",
      payoutBatchId: null,
      items: new Map(),
    },
    reason: "test",
    label: "Replayed (labelled)",
  });
  const send = await rail.replay.tk("send_invoice", { invoice_id: "INV2-RPLY-THIS" });
  const get = await rail.replay.tk("get_invoice", { invoice_id: "INV2-RPLY-THIS" });
  expect(JSON.stringify({ send, get })).not.toContain("INV2-SIM-SOURCE");
});
