import { describe, expect, it } from "vitest";
import type { ItemStatus, ItemUpdatedPayload, RunEvent } from "../_shims/contracts";
import {
  amountIsSolid,
  CAPSULE_WORD,
  capsuleFor,
  EMPTY_TRACK,
  type ItemTrack,
  reduceItemEvent,
} from "./item-status";

const ITEM = "r37-M-014";
let n = 0;
function ev(
  status: ItemStatus,
  id = `evt_${++n}`,
  senderItemId = ITEM,
): RunEvent<"item.updated", ItemUpdatedPayload> {
  return {
    id,
    ws: "ws_showcase",
    runId: "run_2026A_r37",
    type: "item.updated",
    at: `2026-10-30T01:12:${String(n % 60).padStart(2, "0")}Z`,
    actor: { kind: "paypal", id: "paypal" },
    provenance: "live",
    payload: { senderItemId, memberNo: "M-014", status, source: "webhook", signature: "self" },
  };
}

function run(events: RunEvent<"item.updated", ItemUpdatedPayload>[], track: ItemTrack = EMPTY_TRACK) {
  const effects: string[] = [];
  let t = track;
  for (const e of events) {
    const r = reduceItemEvent(t, e, ITEM);
    t = r.track;
    effects.push(r.effect);
  }
  return { track: t, effects };
}

describe("item.updated on the member's phone", () => {
  it("moves sent → paid", () => {
    const { track, effects } = run([ev("PENDING"), ev("SUCCESS")]);
    expect(track.status).toBe("SUCCESS");
    expect(effects).toEqual(["applied", "applied"]);
  });

  it("inv.i5.forward-only: a late PENDING never undoes Bayad na", () => {
    const { track, effects } = run([ev("PENDING"), ev("SUCCESS"), ev("PENDING"), ev("ONHOLD")]);
    expect(track.status).toBe("SUCCESS");
    expect(effects).toEqual(["applied", "applied", "stale", "stale"]);
  });

  it("inv.i5.duplicate-delivery: a repeated event is recognised and changes nothing", () => {
    const paid = ev("SUCCESS", "evt_paid");
    const { track, effects } = run([ev("PENDING"), paid, paid]);
    expect(effects).toEqual(["applied", "applied", "duplicate"]);
    expect(track.status).toBe("SUCCESS");
  });

  it("inv.i5.returned-only-after-own-cancel: RETURNED from PayPal alone is ignored", () => {
    const { track, effects } = run([ev("PENDING"), ev("UNCLAIMED"), ev("RETURNED")]);
    expect(track.status).toBe("UNCLAIMED");
    expect(effects.at(-1)).toBe("stale");
    const own = reduceItemEvent(track, ev("RETURNED"), ITEM, { ownCancel: true });
    expect(own.track.status).toBe("RETURNED");
  });

  it("ignores events for other members' items", () => {
    const r = reduceItemEvent(EMPTY_TRACK, ev("SUCCESS", "evt_other", "r37-M-007"), ITEM);
    expect(r.effect).toBe("other-item");
    expect(r.track).toBe(EMPTY_TRACK);
  });
});

describe("status capsule", () => {
  it.each([
    [{ lineState: "READY", itemStatus: null }, "checking", "HELD"],
    [{ lineState: "HELD", itemStatus: null }, "held-line", "HELD"],
    [{ lineState: "PAYPAL_PENDING", itemStatus: "PENDING" }, "sent", "PAYPAL_PENDING"],
    [{ lineState: "PAYPAL_PENDING", itemStatus: "SUCCESS" }, "paid", "PAID"],
    [{ lineState: "PAYPAL_PENDING", itemStatus: "UNCLAIMED" }, "unclaimed", "UNCLAIMED"],
    [{ lineState: "OFF_RAIL_DUE", itemStatus: "RETURNED" }, "cash-due", "OFF_RAIL_DUE"],
    [{ lineState: "OFF_RAIL_PAID", itemStatus: null }, "cash-received", "OFF_RAIL_PAID"],
    [{ lineState: "PAYPAL_PENDING", itemStatus: "BLOCKED" }, "needs-action", "NEEDS_ACTION"],
    [{ lineState: "PAYPAL_PENDING", itemStatus: "ONHOLD" }, "paypal-held", "PAYPAL_HELD"],
    [{ lineState: "PAID", itemStatus: "REVERSED" }, "reversed", "REVERSED"],
  ] as const)("%j shows %s with the register's word for %s", (line, state, word) => {
    const s = capsuleFor({ rail: "PAYPAL", ...line });
    expect(s).toBe(state);
    expect(CAPSULE_WORD[s]).toBe(word);
  });

  it("keeps the amount hollow until it is in the member's hands", () => {
    expect(amountIsSolid("sent")).toBe(false);
    expect(amountIsSolid("cash-due")).toBe(false);
    expect(amountIsSolid("paid")).toBe(true);
    expect(amountIsSolid("cash-received")).toBe(true);
  });
});
