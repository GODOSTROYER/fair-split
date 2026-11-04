import { getSnapshot } from "@fairsplit/api-client/seed";
import type { RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { FANOUT, SPLIT } from "../features/split/shared/copy.js";
import { describeContext, describeEvent } from "./describe.js";
import { payoutReplayed, payoutReplaySummary } from "./payout-replay.js";
import { applyRunEvent, emptyRunView } from "./run-view.js";

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
