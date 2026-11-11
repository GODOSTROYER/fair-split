// Rhea's signed UNCLAIMED notice processed only after she was moved to cash (the settle GET named her UNCLAIMED
// first, and "Pay in cash" ran before the outbox reached her notice). Its fresh GET now says RETURNED, but the notice
// still attests the UNCLAIMED step our cancel needed: it must enter the chain, so PayPal's CANCELED can then rest
// Rhea's RETURNED on it. Before the fix the late notice was dropped (NO_APPLY) and plate 6 failed for good.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ITEM_EVENTS,
  itemWebhookRows,
  payRheaInCash,
  postedOnSim,
  proofNow,
  rheaChain,
  runState,
  runWebhooksOf,
  type SimHarness,
  settleGet,
} from "./test/race.js";

let h: SimHarness;
let batchId: string;

beforeAll(async () => {
  ({ h, batchId } = await postedOnSim());
});
afterAll(async () => {
  expect(h?.sim.violations).toEqual([]);
  await h?.close();
});

describe("inv.i5/G4: a late UNCLAIMED notice after our cancel still rests Rhea's RETURNED", () => {
  it("settle GET, the SUCCEEDED notices, then Pay in cash: the run settles before Rhea's notices are read", async () => {
    await settleGet(h, batchId);
    expect(await runWebhooksOf(h, [ITEM_EVENTS.succeeded])).toHaveLength(7);
    await payRheaInCash(h);
    expect(await runState(h)).toBe("SETTLED");
    await h.sim.idle();
    expect(await rheaChain(h)).toEqual(["payout.cancel"]);
  });

  it("the late UNCLAIMED then the CANCELED: both enter the chain in order and plate 6 holds", async () => {
    expect(await runWebhooksOf(h, [ITEM_EVENTS.unclaimed, ITEM_EVENTS.canceled])).toEqual([
      ITEM_EVENTS.unclaimed,
      ITEM_EVENTS.canceled,
    ]);
    expect(await rheaChain(h)).toEqual([
      "payout.cancel",
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED UNCLAIMED",
      "PAYMENT.PAYOUTS-ITEM.CANCELED RETURNED",
    ]);
    expect((await itemWebhookRows(h)).filter((r) => !r.includes(":applied"))).toEqual([]);
    const p = await proofNow(h);
    expect(p.failed).toEqual([]);
    expect(["verified", "sample"]).toContain(p.status);
    expect(p.item("M-031")).toMatchObject({ status: "RETURNED", eventId: expect.any(String) });
    expect(p.items.filter((i) => i.status === "SUCCESS" && i.eventId !== null)).toHaveLength(7);
  });
});
