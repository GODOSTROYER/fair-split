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
  sessionView,
  showcaseView,
} from "./run-view.js";

const snapshot = seedSnapshot();

/** A whole judge run from the mock world, in order: funding, by-hand, three holds, two keys, the fan-out. */
function judgeRun() {
  const world = createTestWorld();
  world.markPaid();
  world.resolveAll();
  world.sign("treasurer");
  world.cosign();
  return { world, session: { runSlug: world.runSlug, runId: world.runId }, events: world.eventsAfter(null) };
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

  it("starts a judge session's run from the INVOICED clone, under the session's own run", () => {
    const view = sessionView(snapshot, { runSlug: "2026A-r4170001", runId: snapshot.run.id });
    expect(view).toMatchObject({ origin: "session", runSlug: "2026A-r4170001", state: "INVOICED" });
    expect(view.invoice).toEqual(firstView(snapshot).invoice);
    expect(view.lastEventId).toBeNull();
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
    const view = applyRunEvents(sessionView(snapshot, session), events);
    expect(view.state).toBe("NEEDS_FOLLOW_UP");
    expect(blockingHolds(view)).toEqual([]);
    expect(view.approvals.treasurer?.role).toBe("treasurer");
    expect(view.approvals.chair?.role).toBe("chair");
    const counts = itemCounts(view);
    expect(counts.total).toBe(snapshot.figures.batchItemCount);
    expect(counts.confirmed).toBe(snapshot.figures.batchItemCount - 1); // Rhea parks
    // The mock reports item moves without webhook.received rows (reported to WS-API); count what it sent.
    const deliveries = events.filter((e) => e.type === "webhook.received");
    expect(view.webhooks.received).toBe(deliveries.length);
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
    const view = applyRunEvents(sessionView(snapshot, session), events);
    const again = applyRunEvents(view, events);
    expect(again).toBe(view);
  });

  it("inv.i5.items-climb: a payout item never moves down in rank", () => {
    const { session, events } = judgeRun();
    const view = applyRunEvents(sessionView(snapshot, session), events);
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

  it("counts PayPal's webhook deliveries and a repeated one (dedupe shows, nothing moves twice)", () => {
    const delivery = (id: string, duplicate: boolean): RunEvent => ({
      id,
      ws: "ws",
      runId: null,
      at: new Date().toISOString(),
      actor: { kind: "paypal", id: "paypal:webhook", impersonatedBy: null },
      provenance: "simulated_rail",
      type: "webhook.received",
      payload: {
        webhookEventId: `wh-${id}`,
        paypalEventId: "WH-MOCK-1",
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        verified: "self",
        duplicate,
      },
    });
    const view = applyRunEvents(emptyRunView("2026A-r4170009", "session"), [
      delivery("1", false),
      delivery("2", true),
    ]);
    expect(view.webhooks).toMatchObject({ received: 2, duplicates: 1 });
    expect(view.webhooks.last).toMatchObject({ paypalEventId: "WH-MOCK-1", duplicate: true, eventId: "2" });
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
    const at = (n: number) => applyRunEvents(sessionView(snapshot, session), events.slice(0, n));
    const approvedAt = events.findIndex((e) => e.type === "run.state" && e.payload.to === "APPROVED");
    const pendingAt = events.findIndex((e) => e.type === "item.updated" && e.payload.to === "PENDING");
    expect(lineAmountState(at(approvedAt), "M-014")).toBe("pencil");
    expect(lineAmountState(at(approvedAt + 1), "M-014")).toBe("ink");
    expect(lineAmountState(at(pendingAt + 8), "M-014")).toBe("hollow");
    expect(lineAmountState(at(events.length), "M-014")).toBe("landed");
  });
});

it("inv.i4 a refused signed batch returns to review with both approvals voided", () => {
  const approved = { ...showcaseView(snapshot), state: "APPROVED" as const };
  expect(approved.approvals.treasurer).not.toBeNull();
  const next = applyRunEvent(approved, {
    id: "999999",
    runId: approved.runId,
    ws: "ws",
    at: "2026-11-01T10:00:00Z",
    provenance: "live",
    actor: { kind: "system", id: "outbox", impersonatedBy: null },
    type: "run.state",
    payload: {
      runId: approved.runId,
      from: "APPROVED",
      to: "IN_REVIEW",
      cause: { code: "SEND_BACK", ref: "DIGEST_MISMATCH" },
    },
  } as RunEvent);
  expect(next.state).toBe("IN_REVIEW");
  expect(next.approvals.treasurer).toBeNull();
  expect(next.approvals.chair).toBeNull();
});
