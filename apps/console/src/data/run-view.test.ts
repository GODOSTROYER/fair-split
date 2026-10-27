// The run view is a pure reducer over IC-01 RunEvents. Invariant I5 (state only moves forward) holds on the
// client too: a replayed event changes nothing, payout items only climb in rank, an exit state is final.

import type { RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { createTestWorld, seedSnapshot } from "../test/world.js";
import {
  applyRunEvent,
  applyRunEvents,
  atLeast,
  blockingHolds,
  compareEventIds,
  emptyRunView,
  firstView,
  holdCards,
  invoiceAmountState,
  itemCounts,
  lineAmountState,
  runStrip,
  showcaseView,
} from "./run-view.js";

const snapshot = seedSnapshot();

/** A whole judge run from the mock world, in order (instant pace). */
function judgeRun() {
  const world = createTestWorld();
  const session = world.createJudgeSession();
  world.markPaid(session.runSlug);
  const h1 = world.holdIdFor(session.runSlug, "H1");
  const h2 = world.holdIdFor(session.runSlug, "H2");
  const h3 = world.holdIdFor(session.runSlug, "H3");
  const field = world.byHandFieldId(session.runSlug);
  if (!h1 || !h2 || !h3 || !field) throw new Error("the seed lost a hold");
  world.enterField(field, { value: "64.80" });
  world.resolveHold(h1, { resolution: "COUNT_ONCE" });
  world.resolveHold(h2, {
    resolution: "REGISTER_PLOT",
    plot: { plotNo: "P-053-B", areaHa: "0.80", trees: 120 },
  });
  world.resolveHold(h3, { resolution: "RETURN_AS_CREDIT" });
  const payload = world.approvalPayload(session.runSlug, "treasurer").payload;
  world.submitApproval(session.runSlug, {
    role: "treasurer",
    keyId: "fs-analyn-w1",
    signature: "a".repeat(128),
    payload,
  });
  world.cosign(session.runSlug);
  const events = world.eventsAfter(`run:${session.runSlug}`, null);
  return { world, session, events };
}

describe("run view reducer", () => {
  it("compares SSE IDs as numbers of any length", () => {
    expect(compareEventIds("9", "10")).toBeLessThan(0);
    expect(compareEventIds("100", "99")).toBeGreaterThan(0);
    expect(compareEventIds("42", "42")).toBe(0);
  });

  it("builds the first view from the seed with no calls: the invoice sent and hollow", () => {
    const view = firstView(snapshot);
    expect(view.origin).toBe("first-view");
    expect(view.state).toBe("INVOICED");
    expect(view.invoice.status).toBe("SENT");
    expect(view.invoice.dueCents).toBe(snapshot.run.invoice.amountCents);
    expect(invoiceAmountState(view)).toBe("hollow");
    expect(view.events).toEqual([]);
  });

  it("reads the showcase run's end state from the seed", () => {
    const view = showcaseView(snapshot);
    expect(view.state).toBe(snapshot.run.state);
    expect(itemCounts(view).total).toBe(snapshot.figures.batchItemCount);
    expect(holdCards(view).map((h) => h.label)).toEqual(["H1", "H2", "H3"]);
    expect(invoiceAmountState(view)).toBe("landed");
  });

  it("plays a whole judge run to settlement, with every hold resolved and both keys signed", () => {
    const { session, events } = judgeRun();
    const view = applyRunEvents(emptyRunView(session.runSlug, "session"), events);
    expect(view.state).toBe("NEEDS_FOLLOW_UP");
    expect(blockingHolds(view)).toEqual([]);
    expect(view.approvals.treasurer?.role).toBe("treasurer");
    expect(view.approvals.chair?.role).toBe("chair");
    const counts = itemCounts(view);
    expect(counts.total).toBe(snapshot.figures.batchItemCount);
    expect(counts.confirmed).toBe(snapshot.figures.batchItemCount - 1); // Rhea parks
    expect(view.webhooks.duplicates).toBe(1);
    expect(runStrip(view, true)).toMatchObject({
      RATIFIED: true,
      FUNDED: true,
      READ: true,
      CHECKED: true,
      APPROVED: true,
    });
    expect(lineAmountState(view, "M-014")).toBe("landed");
    expect(view.lastEventId).toBe(events.at(-1)?.id);
  });

  it("inv.i5.replay: an event at or below the last applied ID changes nothing", () => {
    const { session, events } = judgeRun();
    const view = applyRunEvents(emptyRunView(session.runSlug, "session"), events);
    const again = applyRunEvents(view, events);
    expect(again).toBe(view);
  });

  it("inv.i5.items-climb: a payout item never moves down in rank", () => {
    const { session, events } = judgeRun();
    const view = applyRunEvents(emptyRunView(session.runSlug, "session"), events);
    const paid = Object.values(view.items).find((i) => i.status === "SUCCESS");
    if (!paid) throw new Error("no paid item");
    const late: RunEvent = {
      id: String(Number(view.lastEventId) + 1),
      ws: "ws",
      runId: view.runId,
      at: new Date().toISOString(),
      actor: { kind: "paypal", id: "paypal", impersonatedBy: null },
      provenance: "simulated_rail",
      type: "item.updated",
      payload: {
        itemId: "late",
        senderItemId: paid.senderItemId,
        memberNo: paid.memberNo,
        payoutItemId: paid.payoutItemId,
        from: "SUCCESS",
        to: "PENDING",
        rank: 10,
        source: "status_check",
        eventId: null,
      },
    };
    const next = applyRunEvent(view, late);
    expect(next.items[paid.senderItemId]?.status).toBe("SUCCESS");
    expect(next.lines[paid.memberNo]?.state).toBe("PAID");
  });

  it("inv.i5.exit-final: a run that was cancelled, denied or halted stays there", () => {
    const base = emptyRunView("2026A-r4170009", "session");
    const event = (id: string, from: string, to: string): RunEvent =>
      ({
        id,
        ws: "ws",
        runId: null,
        at: new Date().toISOString(),
        actor: { kind: "system", id: "fs-api", impersonatedBy: null },
        provenance: "live",
        type: "run.state",
        payload: { runId: "run", from, to, cause: { code: "test", ref: null } },
      }) as RunEvent;
    const denied = applyRunEvents(base, [event("1", "DRAFT", "DENIED"), event("2", "DENIED", "IN_REVIEW")]);
    expect(denied.state).toBe("DENIED");
    expect(atLeast(denied, "DRAFT")).toBe(false);
  });

  it("ignores another run's events", () => {
    const { session, events } = judgeRun();
    const view = applyRunEvents(
      { ...emptyRunView(session.runSlug, "session"), runId: "someone-else" },
      events,
    );
    expect(view.applied).toBe(0);
  });

  it("amounts follow S2.2.1: pencil before approval, ink after, hollow in flight, landed when PayPal confirms", () => {
    const { session, events } = judgeRun();
    const at = (n: number) => applyRunEvents(emptyRunView(session.runSlug, "session"), events.slice(0, n));
    const approvedAt = events.findIndex((e) => e.type === "run.state" && e.payload.to === "APPROVED");
    const pendingAt = events.findIndex((e) => e.type === "item.updated" && e.payload.to === "PENDING");
    expect(lineAmountState(at(approvedAt), "M-014")).toBe("pencil");
    expect(lineAmountState(at(approvedAt + 1), "M-014")).toBe("ink");
    expect(lineAmountState(at(pendingAt + 8), "M-014")).toBe("hollow");
    expect(lineAmountState(at(events.length), "M-014")).toBe("landed");
  });
});
