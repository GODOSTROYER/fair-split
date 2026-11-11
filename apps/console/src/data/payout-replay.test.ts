import { getSnapshot } from "@fairsplit/api-client/seed";
import { PAYOUT_ITEM_STATUSES, type RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import {
  fanView,
  latency,
  restingPhase,
  shareCounts,
  summaryFacts,
  threadTone,
} from "../features/fanout/model.js";
import { isCashLine, lineHistory, lineScreenState, smsText } from "../features/print/model.js";
import { amountStateOf, liveItems } from "../features/proof/model.js";
import { splitRows } from "../features/split/model.js";
import { FANOUT, SPLIT } from "../features/split/shared/copy.js";
import { describeContext, describeEvent } from "./describe.js";
import { payoutReplayed, payoutReplaySummary, payoutStatus, REPLAY_STATUS_DETAIL } from "./payout-replay.js";
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
    // The long note is the log's, said once per surface (RunLog's header, the Ribbon's one row), not per row.
    expect(row?.replayNote).toContain("earlier simulated run");
    expect(row?.detail).not.toContain("earlier simulated run");
    expect(`${row?.detail} ${row?.replayNote}`).not.toMatch(/Confirmed|seed stand-in|Claude|SUCCEEDED/);
  });
});

it("inv.i8.simulated payout copy names its rail with sentence case", () => {
  // Split review's decided words are counts, not a sentence about PayPal: the screen's honesty tag carries the
  // rail once the batch posts (W-TR-05.simulated), and nothing there claims a confirmation.
  expect(SPLIT.decidedApproved).not.toMatch(/PayPal|confirm/i);
  // The run's own words never name the rail in a sentence (its one tag does); those that must, say simulated.
  for (const text of [FANOUT.feesSoFar, FANOUT.denied, FANOUT.replayedStatus, SPLIT.declined]) {
    expect(text).toMatch(/simulated/i);
    expect(text).not.toContain(". the ");
  }
  for (const text of [FANOUT.rheaLine, FANOUT.rerouted("Rhea"), FANOUT.posted("10:00", "0:05")])
    expect(text).not.toMatch(/sandbox|PayPal confirm/i);
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
  expect(shareCounts(fan).confirmed).toBe(6);
  expect(shareCounts(fan).replayedSuccessful).toBe(1);
  expect(shareCounts(fan).confirmed + shareCounts(fan).replayedSuccessful).toBe(7);
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

it.each(["replay", "simulated_rail"] as const)(
  "inv.i8.a %s return stays payout evidence until the separate cash transition",
  (provenance) => {
    const base = showcaseView(snapshot);
    const line = base.lines["M-014"];
    if (!line) throw new Error("M-014 line required");
    const returned = {
      ...replay,
      provenance,
      type: "line.state",
      payload: { memberNo: "M-014", from: "PAYPAL_PENDING", to: "RETURNED" },
    } as RunEvent;
    const view = {
      ...base,
      origin: "session" as const,
      events: [returned],
      lines: { ...base.lines, "M-014": { ...line, state: "RETURNED" as const } },
      items: Object.fromEntries(
        Object.entries(base.items).map(([id, item]) => [
          id,
          item.memberNo === "M-014"
            ? { ...item, provenance, status: "RETURNED" as const, source: "cancel" as const }
            : item,
        ]),
      ),
    };
    const row = splitRows(snapshot, view).find((line) => line.memberNo === "M-014");
    const member = snapshot.members.find((line) => line.memberNo === "M-014");
    if (!row || !member) throw new Error("M-014 fixture required");
    expect(isCashLine(row)).toBe(false);
    // A replayed line's screen reads replay (like the grid); a live return is parked. Neither is cash yet.
    expect(lineScreenState(view, row)).toBe(provenance === "replay" ? "replay" : "parked");
    expect(row.replayed).toBe(provenance === "replay");
    expect(row.amountState).toBe("hollow");
    const words = [
      payoutStatus({ state: "RETURNED", provenance }).statusWord,
      lineHistory(snapshot, view, "M-014")[0]?.words,
      smsText(snapshot, member, row, lineScreenState(view, row), "en"),
      fanView(snapshot, view).threads.find((line) => line.memberNo === "M-014")?.statusWord,
    ];
    for (const word of words) {
      if (provenance === "replay") expect(word).toMatch(/Replayed \(labelled\)/);
      else {
        expect(word).toMatch(/simulated PayPal sandbox/i);
        expect(word).not.toMatch(/replay/i);
      }
    }
    if (provenance === "replay") {
      // Each row says what replayed; the surface says once where it came from.
      for (const word of [words[0], words[1], words[3]]) expect(word).toBe("Replayed (labelled): returned");
      expect(words[2]).toMatch(/simulated PayPal sandbox/i);
      expect(payoutStatus({ state: "RETURNED", provenance }).detail).toMatch(/simulated PayPal sandbox/);
      expect(lineHistory(snapshot, view, "M-014")[0]?.detail).toBe(REPLAY_STATUS_DETAIL);
    }
    const cash = { ...row, state: "OFF_RAIL_DUE" as const, movedToCash: true, replayed: false };
    expect(smsText(snapshot, member, cash, "cash-due", "en")).not.toMatch(/replay/i);
  },
);

it.each(PAYOUT_ITEM_STATUSES)(
  "inv.i8.a replayed %s says which status replayed and never Paid",
  (itemStatus) => {
    const word = payoutStatus({ itemStatus, provenance: "replay" }).statusWord;
    expect(word).toMatch(/^Replayed \(labelled\): \S/);
    expect(word).not.toMatch(/\bPaid\b|Bayad na/i);
    const others = PAYOUT_ITEM_STATUSES.filter((s) => s !== itemStatus).map(
      (s) => payoutStatus({ itemStatus: s, provenance: "replay" }).statusWord,
    );
    expect(others).not.toContain(word);
  },
);

it("inv.i8.replay words for a success, a parked line and a return", () => {
  expect(payoutStatus({ itemStatus: "SUCCESS", provenance: "replay" }).statusWord).toBe(
    "Replayed (labelled): successful in the earlier run",
  );
  expect(payoutStatus({ state: "PAID", replayed: true }).statusWord).toBe(
    "Replayed (labelled): successful in the earlier run",
  );
  expect(payoutStatus({ state: "UNCLAIMED", replayed: true }).statusWord).toBe("Replayed (labelled): parked");
  expect(payoutStatus({ itemStatus: "RETURNED", provenance: "replay" }).statusWord).toBe(
    "Replayed (labelled): returned",
  );
});

/** Every item replayed, Rhea's line parked (UNCLAIMED) rather than moved to cash. */
function replayedWithRheaParked() {
  const base = showcaseView(snapshot);
  const rhea = base.lines["M-031"];
  if (!rhea) throw new Error("M-031 line required");
  return {
    ...base,
    origin: "session" as const,
    lines: { ...base.lines, "M-031": { ...rhea, state: "UNCLAIMED" as const } },
    items: Object.fromEntries(
      Object.entries(base.items).map(([id, item]) => [
        id,
        {
          ...item,
          provenance: "replay" as const,
          ...(item.memberNo === "M-031" ? { status: "UNCLAIMED" as const, source: "webhook" as const } : {}),
        },
      ]),
    ),
  };
}

it("inv.i8.the run log, line history and fan tell Rhea's replayed parked line from a replayed success", () => {
  const view = replayedWithRheaParked();
  const ctx = describeContext(snapshot);
  const success = describeEvent(replay, ctx);
  const parked = describeEvent(
    {
      ...replay,
      id: "2",
      payload: { ...replay.payload, senderItemId: "r37-M-031", memberNo: "M-031", to: "UNCLAIMED" },
    } as RunEvent,
    ctx,
  );
  expect(success?.words).toContain("successful in the earlier run");
  expect(parked?.words).toContain("parked");
  expect(parked?.words).not.toContain("successful");
  for (const row of [success, parked]) expect(row?.words).not.toMatch(/\bPaid\b/);

  const fan = fanView(snapshot, view);
  const word = (no: string) => fan.threads.find((t) => t.memberNo === no)?.statusWord;
  expect(word("M-014")).toBe("Replayed (labelled): successful in the earlier run");
  expect(word("M-031")).toBe("Replayed (labelled): parked");

  const history = lineHistory(
    snapshot,
    {
      ...view,
      events: [
        { ...replay, id: "1", payload: { ...replay.payload, from: "SUBMITTED", to: "PENDING" } } as RunEvent,
        { ...replay, id: "2" },
      ],
    },
    "M-014",
  );
  expect(history.map((h) => h.words)).toEqual([
    "Replayed (labelled): pending",
    "Replayed (labelled): successful in the earlier run",
  ]);
  // The long detail is said once in the list, not on every row.
  expect(history.filter((h) => h.detail === REPLAY_STATUS_DETAIL)).toHaveLength(1);
});

it("inv.i8.replayed threads never count as landed: phase, latency, summary and share", () => {
  const view = replayedWithRheaParked();
  const funded = {
    ...view,
    events: [
      {
        id: "f",
        ws: "test",
        runId: snapshot.run.id,
        at: "2026-11-01T00:00:00Z",
        type: "run.state",
        provenance: "replay",
        actor: { kind: "system", id: "engine", impersonatedBy: null },
        payload: { from: "INVOICED", to: "FUNDED" },
      } as RunEvent,
    ],
    items: Object.fromEntries(
      Object.entries(view.items).map(([id, item]) => [id, { ...item, at: "2026-11-01T00:01:00Z" }]),
    ),
    state: "SETTLING" as const,
  };
  const fan = fanView(snapshot, funded);
  expect(fan.threads.some((t) => t.tone === "landed")).toBe(false);
  expect(fan.threads.find((t) => t.memberNo === "M-014")?.amountState).toBe("hollow");
  expect(restingPhase(funded, fan)).not.toBe("landing");
  expect(latency(funded, fan).dots).toEqual([]);
  expect(summaryFacts(snapshot, fan).paid).toBe(0);
  expect(shareCounts(fan)).toMatchObject({ confirmed: 0, replayedSuccessful: 7 });
});

it("inv.i8.our own RETURNED is a neutral return, never a failure, until the cash decision moves it", () => {
  expect(threadTone("RETURNED", undefined, "RETURNED")).toBe("returned");
  expect(threadTone("RETURNED", undefined, undefined)).toBe("returned");
  expect(threadTone("RETURNED", undefined, "OFF_RAIL_DUE")).toBe("moved");
  const base = showcaseView(snapshot);
  const rhea = base.lines["M-031"];
  if (!rhea) throw new Error("M-031 line required");
  const view = { ...base, lines: { ...base.lines, "M-031": { ...rhea, state: "RETURNED" as const } } };
  const fan = fanView(snapshot, view);
  expect(fan.threads.find((t) => t.memberNo === "M-031")?.tone).toBe("returned");
  expect(shareCounts(fan).failed).toBe(0);
});
