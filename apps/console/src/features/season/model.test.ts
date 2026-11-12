// The season's read model (W-TR-01 and the first view): its S1 states, the run strip's true sequence, and the
// invoice Claude drafted whose every amount is the code's quote.

import { getSnapshot } from "@fairsplit/api-client/seed";
import type { RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { applyRunEvents, firstView, type RunView, sessionView, showcaseView } from "../../data/run-view.js";
import {
  invoiceLines,
  isFunded,
  isRatified,
  labelHasNoDigits,
  nextSentence,
  poolOf,
  quoteBalances,
  seasonState,
  stripStages,
} from "./model.js";

const snapshot = getSnapshot();
const session = sessionView(snapshot, { runSlug: snapshot.run.runSlug, runId: snapshot.run.id });

let seq = 0;
function event<T extends RunEvent["type"]>(
  type: T,
  payload: Extract<RunEvent, { type: T }>["payload"],
): RunEvent {
  seq += 1;
  return {
    id: String(seq),
    ws: "ws",
    runId: snapshot.run.id,
    at: "2026-10-29T02:00:00.000Z",
    actor: { kind: "paypal", id: "paypal:get", impersonatedBy: null },
    provenance: "simulated_rail",
    type,
    payload,
  } as RunEvent;
}

function funded(view: RunView): RunView {
  return applyRunEvents(view, [
    event("invoice.state", {
      invoiceId: "INV2",
      invoiceNumber: snapshot.run.invoice.invoiceNumber,
      from: "SENT",
      to: "MARKED_AS_PAID",
      dueCents: 0,
    }),
    event("run.state", {
      runId: snapshot.run.id,
      from: "INVOICED",
      to: "FUNDED",
      cause: { code: "FUND", ref: null },
    }),
  ]);
}

describe("season state (S1.7 W-TR-01)", () => {
  it("waits for Lantern Bay on the first view, and is funded once the GET reads paid", () => {
    expect(seasonState({ view: firstView(snapshot), snapshot, online: true })).toBe("waiting");
    expect(seasonState({ view: funded(session), snapshot, online: true })).toBe("funded");
    expect(seasonState({ view: showcaseView(snapshot), snapshot, online: true })).toBe("funded");
  });

  it("says offline before anything else, and auto-cancelled when the invoice was cancelled", () => {
    expect(seasonState({ view: funded(session), snapshot, online: false })).toBe("offline");
    const cancelled = applyRunEvents(session, [
      event("invoice.state", {
        invoiceId: "INV2",
        invoiceNumber: "FS",
        from: "SENT",
        to: "CANCELLED",
        dueCents: snapshot.run.invoice.amountCents,
      }),
    ]);
    expect(seasonState({ view: cancelled, snapshot, online: true })).toBe("auto-cancelled");
  });

  it("is unverified when PayPal's notice arrived but the invoice has not read back as paid", () => {
    const noticed = applyRunEvents(session, [
      event("webhook.received", {
        webhookEventId: "wh",
        paypalEventId: "WH-1",
        eventType: "INVOICING.INVOICE.PAID",
        verified: "self",
        duplicate: false,
      }),
    ]);
    expect(seasonState({ view: noticed, snapshot, online: true })).toBe("unverified");
  });

  it("is draft-refused only when the policy verdict on Claude's invoice draft really was DENY", () => {
    const refused = applyRunEvents(session, [
      event("policy.verdict", {
        tool: "create_invoice",
        verdict: "DENY",
        decidedBy: ["invoiceEqualsQuote"],
        reasons: ["The draft's total differs from the quote."],
        sessionId: null,
      }),
    ]);
    expect(seasonState({ view: refused, snapshot, online: true })).toBe("draft-refused");
    const allowed = applyRunEvents(refused, [
      event("policy.verdict", {
        tool: "create_invoice",
        verdict: "ALLOW",
        decidedBy: ["invoiceEqualsQuote"],
        reasons: [],
        sessionId: null,
      }),
    ]);
    expect(seasonState({ view: allowed, snapshot, online: true })).toBe("waiting");
  });

  it("asks for a ratified card first when the card is not ratified", () => {
    const draft = { ...snapshot, rateCard: { ...snapshot.rateCard, ratifications: [] } };
    expect(isRatified(snapshot)).toBe(true);
    expect(seasonState({ view: firstView(snapshot), snapshot: draft, online: true })).toBe("unratified");
  });
});

describe("the run strip (register §7)", () => {
  it("is a true sequence: ratified lights first, then funded, and nothing lights out of order", () => {
    const first = stripStages(firstView(snapshot), snapshot);
    expect(first.map((s) => s.id)).toEqual(["RATIFIED", "FUNDED", "READ", "CHECKED", "APPROVED", "PAID"]);
    expect(first.filter((s) => s.lit).map((s) => s.id)).toEqual(["RATIFIED"]);
    const lit = stripStages(funded(session), snapshot)
      .filter((s) => s.lit)
      .map((s) => s.id);
    expect(lit).toEqual(["RATIFIED", "FUNDED"]);
    expect(isFunded(funded(session))).toBe(true);
  });

  it("never lights Paid while cash is due at the bodega (UI gate round 4); it does once every cash line is handed over", () => {
    // The showcase settled with PayPal's 7 confirmed and 57 lines still due in cash.
    const due = stripStages(showcaseView(snapshot), snapshot);
    const paid = due.find((s) => s.id === "PAID");
    expect(paid?.lit).toBe(false);
    expect(paid?.cashDue).toBe(true);
    expect(due.filter((s) => s.id !== "PAID").every((s) => s.lit)).toBe(true);
    const settled = showcaseView(snapshot);
    const handedOver: RunView = {
      ...settled,
      lines: Object.fromEntries(
        Object.entries(settled.lines).map(([key, line]) => [
          key,
          line.state === "OFF_RAIL_DUE" ? { ...line, state: "OFF_RAIL_PAID" } : line,
        ]),
      ),
    };
    const done = stripStages(handedOver, snapshot).find((s) => s.id === "PAID");
    expect(done?.lit).toBe(true);
    expect(done?.cashDue).toBeFalsy();
  });
});

describe("the invoice Claude drafted", () => {
  it("inv.i1: Claude wrote only the labels; no label carries a digit", () => {
    const lines = invoiceLines(snapshot);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(labelHasNoDigits(line.label), line.label).toBe(true);
  });

  it("inv.i3: the three lines are the invoice, and premium plus bonus is the pool members share", () => {
    expect(quoteBalances(snapshot)).toBe(true);
    const pool = poolOf(snapshot);
    expect(pool.premiumCents + pool.bonusCents).toBe(pool.poolCents);
    expect(pool.poolCents + pool.disbursementCents).toBe(snapshot.run.invoice.amountCents);
  });
});

describe("the next step as a sentence", () => {
  it("drops the pill's 'Next:' and capitalises", () => {
    expect(nextSentence("Next: decide 3 holds")).toBe("Decide 3 holds");
    expect(nextSentence("Next: sign 1 of 2 · 8 payouts")).toBe("Sign 1 of 2 · 8 payouts");
  });
});

it("inv.i8.desk-note: identifies code-composed photos before and after funding", async () => {
  const { FIRST_VIEW_COPY } = await import("./copy.js");
  for (const funded of [false, true]) {
    expect(FIRST_VIEW_COPY.deskNote(12, funded)).toContain("composed in code");
  }
});
