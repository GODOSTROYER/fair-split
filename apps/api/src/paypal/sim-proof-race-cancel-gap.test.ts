// Rhea's signed UNCLAIMED notice processed inside our cancel: after PayPal accepted the cancel, before our own
// RETURNED write. Its fresh GET already says RETURNED, so processing it moves her item, but the notice attests only
// the UNCLAIMED step. Before the fix it was chained as `UNCLAIMED -> RETURNED` (an entry the verifier rightly
// rejects), and PayPal's CANCELED was then refused: plate 6 failed for good. Now the notice enters the chain as the
// step it names, and the CANCELED rests her RETURNED on it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appliedEntries,
  cancelRheaWith,
  heldStatus,
  honestProof,
  ITEM_EVENTS,
  itemWebhookRows,
  postedOnSim,
  reprocessEveryWebhook,
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

describe("inv.i5/G4: a late UNCLAIMED notice read inside our cancel is chained as UNCLAIMED, never as RETURNED", () => {
  it("the settle GET parks Rhea; her UNCLAIMED notice is read between PayPal's cancel and our RETURNED write", async () => {
    await settleGet(h, batchId);
    expect(await runWebhooksOf(h, [ITEM_EVENTS.succeeded])).toHaveLength(7);
    await cancelRheaWith(h, async () => {
      expect(await runWebhooksOf(h, [ITEM_EVENTS.unclaimed])).toEqual([ITEM_EVENTS.unclaimed]);
    });
    expect(await runState(h)).toBe("SETTLED");
    expect(await heldStatus(h, "M-031")).toBe("RETURNED");
    expect(await rheaChain(h)).toEqual(["payout.cancel", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED UNCLAIMED"]);
    // settled, the CANCELED notice not read yet: Rhea reads at the step her notice attests, and every plate holds
    const p = await honestProof(h);
    expect(p.item("M-031")).toMatchObject({ status: "UNCLAIMED", eventId: expect.any(String) });
  });

  it("PayPal's CANCELED then rests her RETURNED; nothing is left unapplied", async () => {
    await h.sim.idle();
    expect(await runWebhooksOf(h, [ITEM_EVENTS.canceled])).toEqual([ITEM_EVENTS.canceled]);
    expect(await rheaChain(h)).toEqual([
      "payout.cancel",
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED UNCLAIMED",
      "PAYMENT.PAYOUTS-ITEM.CANCELED RETURNED",
    ]);
    expect((await itemWebhookRows(h)).filter((r) => !r.includes(":applied"))).toEqual([]);
    const p = await honestProof(h);
    expect(p.item("M-031")).toMatchObject({ status: "RETURNED", eventId: expect.any(String) });
    expect(p.items.filter((i) => i.status === "SUCCESS" && i.eventId !== null)).toHaveLength(7);
  });

  it("a retry of every notice and the follow-up settle GET add nothing to the chain", async () => {
    const before = await appliedEntries(h);
    await reprocessEveryWebhook(h);
    await settleGet(h, batchId, 2);
    expect(await appliedEntries(h)).toBe(before);
    await honestProof(h);
  });
});
