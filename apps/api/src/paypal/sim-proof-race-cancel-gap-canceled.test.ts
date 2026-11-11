// PayPal's CANCELED notice delivered and processed inside our cancel (before our own RETURNED write), while Rhea's
// UNCLAIMED notice is still unread. The CANCELED moves her item and is chained, but the chain cannot fold RETURNED
// without the UNCLAIMED step before it, so Proof does not claim it yet. When the late UNCLAIMED notice is read it is
// chained, and the CANCELED is entered again after it: the same verified event, now in the order plate 6 folds.
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

describe("inv.i5/G4: a CANCELED read inside our cancel, before the UNCLAIMED notice, is not claimed early", () => {
  it("the CANCELED moves Rhea's item inside the cancel; Proof still shows nothing for her", async () => {
    await settleGet(h, batchId);
    expect(await runWebhooksOf(h, [ITEM_EVENTS.succeeded])).toHaveLength(7);
    await cancelRheaWith(h, async () => {
      await h.sim.idle();
      expect(await runWebhooksOf(h, [ITEM_EVENTS.canceled])).toEqual([ITEM_EVENTS.canceled]);
    });
    expect(await runState(h)).toBe("SETTLED");
    expect(await heldStatus(h, "M-031")).toBe("RETURNED");
    expect(await rheaChain(h)).toEqual(["payout.cancel", "PAYMENT.PAYOUTS-ITEM.CANCELED RETURNED"]);
    const p = await honestProof(h);
    expect(p.item("M-031")).toMatchObject({ status: "SUBMITTED", eventId: null });
  });

  it("the late UNCLAIMED is chained and the CANCELED entered again after it: her RETURNED now rests", async () => {
    expect(await runWebhooksOf(h, [ITEM_EVENTS.unclaimed])).toEqual([ITEM_EVENTS.unclaimed]);
    expect(await rheaChain(h)).toEqual([
      "payout.cancel",
      "PAYMENT.PAYOUTS-ITEM.CANCELED RETURNED",
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
