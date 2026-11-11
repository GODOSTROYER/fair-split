// Proof while the run is still settling (the film's 5-of-6 on a loaded host). Two writes land an item's status before
// PayPal's signed notice for it is processed: the settle GET (SUCCESS, UNCLAIMED) and our own cancel (Rhea's
// RETURNED, from PayPal's answer). "Pay in cash" settles the run at once, so a judge who opens Proof straight after
// MM-6 reads it inside that window. Proof must never fail its check there, nor show a status no verified event backs:
// each item reads at the status the chain's verified notices attest (SUBMITTED while none has landed), and catches up
// as they do. The verifier is unchanged; what is served is.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  heldStatus,
  ITEM_EVENTS,
  payRheaInCash,
  postedOnSim,
  proofNow,
  runState,
  runWebhooksOf,
  type SimHarness,
  settleGet,
} from "./test/race.js";

let h: SimHarness;
let batchId: string;
/** The signed UNCLAIMED notice Rhea's parked status rests on. */
let unclaimedEventId: string | null | undefined;

beforeAll(async () => {
  ({ h, batchId } = await postedOnSim());
});
afterAll(async () => {
  expect(h?.sim.violations).toEqual([]);
  await h?.close();
});

describe("inv.i5/G4: Proof inside the settle window reads as settling, never as a failed check", () => {
  it("settle GET before any item notice: every plate holds and no item claims a status the chain lacks", async () => {
    await settleGet(h, batchId);
    expect(await runState(h)).toBe("NEEDS_FOLLOW_UP");
    expect(await heldStatus(h, "M-031")).toBe("UNCLAIMED");
    const p = await proofNow(h);
    expect(p.failed).toEqual([]);
    expect(["verified", "sample"]).toContain(p.status);
    // nothing signed has landed yet: every item still reads as submitted, resting on no event
    expect(p.items.map((i) => [i.status, i.eventId])).toEqual(p.items.map(() => ["SUBMITTED", null]));
  });

  it("once the signed notices are processed, each item reads at the status they attest", async () => {
    expect(await runWebhooksOf(h, [ITEM_EVENTS.succeeded, ITEM_EVENTS.unclaimed])).toHaveLength(8);
    const p = await proofNow(h);
    expect(p.failed).toEqual([]);
    expect(p.items.filter((i) => i.status === "SUCCESS" && i.eventId !== null)).toHaveLength(7);
    expect(p.item("M-031")).toMatchObject({ status: "UNCLAIMED", eventId: expect.any(String) });
    unclaimedEventId = p.item("M-031")?.eventId;
  });

  it("MM-6 'settled' before PayPal's CANCELED is processed: Rhea reads UNCLAIMED, every plate holds", async () => {
    await payRheaInCash(h);
    expect(await runState(h)).toBe("SETTLED");
    expect(await heldStatus(h, "M-031")).toBe("RETURNED");
    const p = await proofNow(h);
    expect(p.failed).toEqual([]);
    expect(["verified", "sample"]).toContain(p.status);
    expect(p.item("M-031")).toMatchObject({ status: "UNCLAIMED", eventId: unclaimedEventId });
  });

  it("the signed CANCELED lands: Rhea's RETURNED now rests on it", async () => {
    await h.sim.idle();
    expect(await runWebhooksOf(h, [ITEM_EVENTS.canceled])).toEqual([ITEM_EVENTS.canceled]);
    const p = await proofNow(h);
    expect(p.failed).toEqual([]);
    expect(p.item("M-031")).toMatchObject({ status: "RETURNED", eventId: expect.any(String) });
    expect(p.item("M-031")?.eventId).not.toBe(unclaimedEventId);
  });
});
