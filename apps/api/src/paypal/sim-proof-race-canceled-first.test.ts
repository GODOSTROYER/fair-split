// Every signed notice delayed past the settle GET and past "Pay in cash" (a busy outbox), and then read in the
// worst order: PayPal's CANCELED before Rhea's UNCLAIMED. The CANCELED alone cannot rest her RETURNED (plate 6 takes
// RETURNED only from UNCLAIMED, after our cancel), so it waits, read and unapplied; when the UNCLAIMED notice is
// chained, the waiting CANCELED follows it in the same step. Proof is opened at every step and never fails.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appliedEntries,
  honestProof,
  ITEM_EVENTS,
  itemWebhookRows,
  payRheaInCash,
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

describe("inv.i5/G4: notices delayed past settlement and read out of order still rest every status", () => {
  it("Proof opened before the settle GET: nothing has moved, nothing is claimed", async () => {
    const p = await honestProof(h);
    expect(p.items.every((i) => i.eventId === null)).toBe(true);
  });

  it("settle GET, then Pay in cash, with no notice read: the run is settled and Proof claims no status", async () => {
    await settleGet(h, batchId);
    await honestProof(h);
    await payRheaInCash(h);
    expect(await runState(h)).toBe("SETTLED");
    await h.sim.idle();
    const p = await honestProof(h);
    expect(p.items.map((i) => [i.status, i.eventId])).toEqual(p.items.map(() => ["SUBMITTED", null]));
  });

  it("the CANCELED read first waits: Rhea's RETURNED is not claimed on it alone", async () => {
    expect(await runWebhooksOf(h, [ITEM_EVENTS.canceled])).toEqual([ITEM_EVENTS.canceled]);
    expect(await rheaChain(h)).toEqual(["payout.cancel"]);
    expect((await itemWebhookRows(h)).filter((r) => r.startsWith(ITEM_EVENTS.canceled))).toEqual([
      `${ITEM_EVENTS.canceled}:orphan(NO_APPLY)`,
    ]);
    const p = await honestProof(h);
    expect(p.item("M-031")).toMatchObject({ status: "SUBMITTED", eventId: null });
  });

  it("the SUCCEEDED notices land one by one; Proof follows them", async () => {
    expect(await runWebhooksOf(h, [ITEM_EVENTS.succeeded])).toHaveLength(7);
    const p = await honestProof(h);
    expect(p.items.filter((i) => i.status === "SUCCESS" && i.eventId !== null)).toHaveLength(7);
    expect(p.item("M-031")).toMatchObject({ status: "SUBMITTED", eventId: null });
  });

  it("the late UNCLAIMED is chained, and the waiting CANCELED right after it", async () => {
    expect(await runWebhooksOf(h, [ITEM_EVENTS.unclaimed])).toEqual([ITEM_EVENTS.unclaimed]);
    expect(await rheaChain(h)).toEqual([
      "payout.cancel",
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED UNCLAIMED",
      "PAYMENT.PAYOUTS-ITEM.CANCELED RETURNED",
    ]);
    expect((await itemWebhookRows(h)).filter((r) => !r.includes(":applied"))).toEqual([]);
    const p = await honestProof(h);
    expect(p.item("M-031")).toMatchObject({ status: "RETURNED", eventId: expect.any(String) });
  });

  it("a retry of every notice and the follow-up settle GET add nothing to the chain", async () => {
    const before = await appliedEntries(h);
    await reprocessEveryWebhook(h);
    await settleGet(h, batchId, 2);
    expect(await appliedEntries(h)).toBe(before);
    await honestProof(h);
  });
});
