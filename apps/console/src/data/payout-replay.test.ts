import { getSnapshot } from "@fairsplit/api-client/seed";
import { PAYOUT_ITEM_STATUSES, type RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { fanView, shareCounts } from "../features/fanout/model.js";
import { lineHistory } from "../features/print/model.js";
import { amountStateOf, liveItems } from "../features/proof/model.js";
import { splitRows } from "../features/split/model.js";
import { FANOUT, SPLIT } from "../features/split/shared/copy.js";
import { describeContext, describeEvent } from "./describe.js";
import { payoutReplayed, payoutReplaySummary, payoutStatus } from "./payout-replay.js";
import { applyRunEvent, emptyRunView, showcaseView } from "./run-view.js";

const snapshot = getSnapshot();
const replay = {
  id: "1",
  type: "item.updated",
  provenance: "replay",
  at: "2026-11-01T00:00:00Z",
  actor: { kind: "paypal", id: "simulator" },
  payload: {
    senderItemId: "r37-M-014",
    memberNo: "M-014",
    from: "PENDING",
    to: "SUCCESS",
    payoutItemId: "RPLY-1",
    eventId: null,
    source: "status_check",
  },
} as RunEvent;
describe("payout replay provenance", () => {
  it("derives replay only from item events or public bundle items", () => {
    expect(payoutReplayed(undefined)).toBe(false);
    expect(payoutReplayed({ ...emptyRunView("2026A-r37", "session"), events: [replay] })).toBe(true);
    expect(
      payoutReplayed(undefined, {
        ...snapshot.proof,
        batch: {
          ...snapshot.proof.batch,
          items: snapshot.proof.batch.items.map((i) => ({ ...i, provenance: "replay" })),
        },
      }),
    ).toBe(true);
    expect(payoutReplayed(undefined, snapshot.proof)).toBe(false);
  });
  it("labels replayed payout log rows without a fresh confirmation or reading claim", () => {
    const row = describeEvent(replay, describeContext(snapshot));
    expect(row?.words).toContain("Replayed (labelled)");
    expect(row?.detail).toContain("earlier simulated run");
    expect(row?.detail).not.toMatch(/Confirmed|seed stand-in|Claude|SUCCEEDED/);
  });
});

it("inv.i8.simulated payout copy names its rail with sentence case", () => {
  for (const text of [SPLIT.decidedApproved, FANOUT.waiting("10:00"), FANOUT.waitingSeeded]) {
    expect(text).toContain(". The simulated PayPal sandbox");
    expect(text).not.toContain(". the ");
  }
  for (const text of [
    FANOUT.rheaWhy("Rhea", "US$26.65"),
    FANOUT.rerouted("Rhea", "30 Oct"),
    FANOUT.feesSoFar,
    SPLIT.declined,
    FANOUT.done(7, 57, "US$21.14"),
  ])
    expect(text).toMatch(/simulated/i);
});

it("inv.i8.counts all replayed statuses and identifies successful statuses separately", () => {
  expect(payoutReplaySummary(7, 8)).toContain("8 payout statuses replayed (labelled)");
  expect(payoutReplaySummary(7, 8)).toContain("7 successful in that source run");
});

it("inv.i8.live simulated payout evidence is never labelled replay", () => {
  const live = applyRunEvent(emptyRunView("2026A-r37", "session"), {
    ...replay,
    provenance: "simulated_rail",
  });
  expect(payoutReplayed(live, snapshot.proof)).toBe(false);
  expect(payoutReplayed(emptyRunView("2026A-r37", "session"))).toBe(false);
});
it("inv.i8.keeps item replay provenance after the event log rolls over", () => {
  const view = applyRunEvent(emptyRunView("2026A-r37", "session"), replay);
  expect(payoutReplayed({ ...view, events: [] })).toBe(true);
});
it("inv.i8.reads ledger replay evidence even without replay-labelled bundle items", () => {
  const entry = snapshot.proof.ledger[0];
  if (!entry) throw new Error("fixture has no ledger");
  expect(
    payoutReplayed(undefined, {
      ...snapshot.proof,
      ledger: [{ ...entry, kind: "payout.item.replayed" }],
    }),
  ).toBe(true);
});

it("inv.i8.mixed items keep each line's evidence and conserve the successful source count", () => {
  const base = showcaseView(snapshot);
  const view = {
    ...base,
    events: [replay],
    items: Object.fromEntries(
      Object.entries(base.items).map(([id, item]) => [
        id,
        item.memberNo === "M-014" ? { ...item, provenance: "replay" as const } : item,
      ]),
    ),
  };
  const fan = fanView(snapshot, view);
  expect(shareCounts(fan).confirmed).toBe(7);
  const source = fan.threads.find((item) => item.memberNo === "M-014");
  expect(source?.amountState).toBe("hollow");
  expect(source?.progress).toBeLessThan(1);
  expect(source?.statusWord).toMatch(/Replayed \(labelled\)/);
  expect(fan.threads.find((item) => item.memberNo === "M-002")?.statusWord).not.toMatch(/replay/i);
  expect(splitRows(snapshot, view).find((row) => row.memberNo === "M-002")?.replayed).toBe(false);
});

it("inv.i8.proof keeps replay SSE evidence over a stale simulated bundle", () => {
  const id = snapshot.proof.batch.items.find((i) => i.senderItemId.endsWith("M-014"))?.senderItemId;
  if (!id) throw new Error("M-014 fixture required");
  const items = liveItems(
    snapshot.proof.batch.items,
    new Map([
      [
        id,
        {
          status: "SUCCESS",
          source: "status_check",
          eventId: null,
          payoutItemId: "RPLY-test",
          at: null,
          provenance: "replay",
        },
      ],
    ]),
  );
  const item = items.find((i) => i.senderItemId === id);
  expect(item).toHaveProperty("provenance", "replay");
  if (!item) throw new Error("current item missing");
  expect(
    payoutStatus({
      itemStatus: item.status,
      provenance: item.provenance,
    }).amountState,
  ).toBe("hollow");
});

it("inv.i8.a new simulated payout attempt does not inherit the earlier item's replay", () => {
  const base = showcaseView(snapshot);
  const old = Object.values(base.items).find((i) => i.memberNo === "M-014");
  if (!old) throw new Error("M-014 required");
  const current = { ...old, senderItemId: "r37x1-M-014", provenance: "simulated_rail" as const };
  const view = {
    ...base,
    items: {
      ...base.items,
      [old.senderItemId]: { ...old, provenance: "replay" as const },
      [current.senderItemId]: current,
    },
  };
  expect(payoutStatus({ itemStatus: "SUCCESS", memberNo: "M-014", view }).replayed).toBe(false);
  expect(splitRows(snapshot, view).find((i) => i.memberNo === "M-014")?.replayed).toBe(false);
  expect(fanView(snapshot, view).threads.find((i) => i.memberNo === "M-014")?.replayed).toBe(false);
});

it("inv.i8.historical line statuses retain their own item-event provenance", () => {
  const base = showcaseView(snapshot);
  const event = {
    ...replay,
    type: "line.state",
    provenance: "simulated_rail",
    payload: { memberNo: "M-014", from: "PAYPAL_PENDING", to: "PAID" },
  } as RunEvent;
  const view = { ...base, origin: "session" as const, events: [event, { ...replay, id: "2" }] };
  const history = lineHistory(snapshot, view, "M-014");
  expect(history[0]?.words).toBe("Paid (Simulated PayPal sandbox)");
  expect(history[1]?.words).toContain("Replayed (labelled)");
});

it.each(PAYOUT_ITEM_STATUSES)("inv.i8.%s has paired replay/live status grammar", (itemStatus) => {
  const replayed = payoutStatus({ itemStatus, provenance: "replay" });
  expect(replayed.replayed).toBe(true);
  expect(replayed.statusWord).toContain("Replayed (labelled)");
  expect(replayed.simulatedLabel).toBe("Simulated PayPal sandbox");
  expect(replayed.tone).toBe("neutral");
  expect(replayed.amountState).toBe("hollow");
  const live = payoutStatus({ itemStatus, provenance: "simulated_rail" });
  expect(live.replayed).toBe(false);
  expect(live.statusWord).not.toMatch(/replay/i);
  expect(live.statusWord).toContain("Simulated PayPal sandbox");
});

it("inv.i8.live line amount grammar remains the established grammar", () => {
  for (const state of [
    "COMPUTED",
    "READY",
    "HELD",
    "EXCLUDED",
    "LOCKED",
    "SUBMITTED",
    "PAYPAL_PENDING",
    "PAID",
    "OFF_RAIL_DUE",
    "OFF_RAIL_PAID",
    "UNCLAIMED",
    "RETURNED",
    "REROUTED",
    "PAYPAL_HELD",
    "NEEDS_ACTION",
    "REVERSED",
  ] as const) {
    expect(payoutStatus({ state }).amountState, state).toBe(amountStateOf(state));
  }
});

it("inv.i8.replayed return retracts the old payout thread when this run moves the line to cash", () => {
  const base = showcaseView(snapshot);
  const view = {
    ...base,
    items: Object.fromEntries(
      Object.entries(base.items).map(([id, item]) => [id, { ...item, provenance: "replay" as const }]),
    ),
  };
  const returned = fanView(snapshot, view).threads.find((item) => item.memberNo === "M-031");
  expect(returned?.tone).toBe("moved");
  expect(returned?.progress).toBe(0);
  expect(returned?.statusWord).toBe("Cash due");
});
