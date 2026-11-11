// What Proof serves for an item (plate 6): the status its verified notices attest, never one we only hold. The
// verifier (packages/domain verify-core) accepts an item with no notice only as SUBMITTED or PENDING with no event,
// and otherwise only at exactly the folded status and event: `attestedItem` serves just those shapes while the held
// status is at or ahead of the chain, and refuses to dress a chain that claims more than we hold.
import { PAYOUT_ITEM_STATUSES, type PayoutItemStatus } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { holdsOrPassed } from "../money/corroborate.js";
import { attestedItem, foldItemEvents } from "./item-fold.js";

const applied = (eventId: string, type: string, status: string, over: Record<string, unknown> = {}) => ({
  kind: "webhook.applied",
  payload: {
    eventId,
    eventType: `PAYMENT.PAYOUTS-ITEM.${type}`,
    verified: "self",
    provenance: "simulated_rail",
    resource: "payout_item",
    senderItemId: "r37-M-031",
    payoutItemId: "ITEM6",
    status,
    ...over,
  },
});
const cancel = {
  kind: "payout.cancel",
  payload: { senderItemId: "r37-M-031", payoutItemId: "ITEM6", afterCancel: "cash" },
};
const fold = (entries: { kind: string; payload: unknown }[]) => foldItemEvents(entries).get("r37-M-031");

describe("inv.i5 attestedItem: an item is served at the status its verified notices attest", () => {
  it("no notice yet: submitted (or pending) with no event, whatever status we already hold", () => {
    for (const held of PAYOUT_ITEM_STATUSES) {
      expect(attestedItem(held, undefined)).toEqual({
        status: held === "PENDING" ? "PENDING" : "SUBMITTED",
        eventId: null,
      });
    }
  });

  it("the held status rests on its notice: served as held, with that event", () => {
    expect(attestedItem("SUCCESS", { status: "SUCCESS", lastEventId: "WH-1" })).toEqual({
      status: "SUCCESS",
      eventId: "WH-1",
    });
  });

  it("held ahead of the notices (our cancel's RETURNED before the signed CANCELED): served at the attested step", () => {
    expect(attestedItem("RETURNED", { status: "UNCLAIMED", lastEventId: "WH-U" })).toEqual({
      status: "UNCLAIMED",
      eventId: "WH-U",
    });
  });

  it("a chain that attests more than we hold is never served as attested: plate 6 refuses it", () => {
    expect(attestedItem("UNCLAIMED", { status: "SUCCESS", lastEventId: "WH-S" })).toEqual({
      status: "UNCLAIMED",
      eventId: null,
    });
    expect(attestedItem("FAILED", { status: "BLOCKED", lastEventId: "WH-B" })).toEqual({
      status: "FAILED",
      eventId: null,
    });
  });
});

describe("inv.i5 the chain orders a late UNCLAIMED notice needs", () => {
  it("our cancel, then the late UNCLAIMED, then CANCELED: folds to RETURNED on the CANCELED event", () => {
    expect(
      fold([cancel, applied("WH-U", "UNCLAIMED", "UNCLAIMED"), applied("WH-C", "CANCELED", "RETURNED")]),
    ).toEqual({
      status: "RETURNED",
      lastEventId: "WH-C",
    });
  });

  it("CANCELED chained before the UNCLAIMED step folds nothing; entered again after it, it does", () => {
    const early = [cancel, applied("WH-C", "CANCELED", "RETURNED")];
    expect(fold(early)).toEqual({ status: "SUBMITTED", lastEventId: null });
    expect(
      fold([...early, applied("WH-U", "UNCLAIMED", "UNCLAIMED"), applied("WH-C", "CANCELED", "RETURNED")]),
    ).toEqual({ status: "RETURNED", lastEventId: "WH-C" });
  });

  it("an entry whose event type names another status (UNCLAIMED chained as RETURNED) attests nothing", () => {
    expect(fold([cancel, applied("WH-U", "UNCLAIMED", "RETURNED")])).toBeUndefined();
  });
});

describe("holdsOrPassed: which notices may be chained for a held status", () => {
  const cases: [PayoutItemStatus, PayoutItemStatus, boolean][] = [
    ["UNCLAIMED", "UNCLAIMED", true],
    ["UNCLAIMED", "RETURNED", true],
    ["UNCLAIMED", "SUCCESS", true],
    ["ONHOLD", "SUCCESS", true],
    ["SUCCESS", "REFUNDED", true],
    ["RETURNED", "RETURNED", true],
    // a notice naming more than PayPal's GET says the item holds
    ["SUCCESS", "UNCLAIMED", false],
    ["RETURNED", "UNCLAIMED", false],
    // nothing follows RETURNED, FAILED or BLOCKED
    ["RETURNED", "SUCCESS", false],
    ["FAILED", "SUCCESS", false],
    ["BLOCKED", "SUCCESS", false],
    ["FAILED", "BLOCKED", false],
    ["SUBMITTED", "SUCCESS", false],
  ];
  it.each(cases)("a %s notice for an item holding %s: %s", (named, held, expected) => {
    expect(holdsOrPassed(named, held)).toBe(expected);
  });
});
