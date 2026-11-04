// The payout-presentation minors of the replay review: each surface asks the shared helper, never decides alone.

import { getSnapshot } from "@fairsplit/api-client/seed";
import {
  type MemberLineState,
  PAYOUT_ITEM_STATUS_LABELS,
  type PayoutItemStatus,
  type RunEvent,
} from "@fairsplit/contracts";
import { UiProvider } from "@fairsplit/ui-web";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describeContext, describeEvent, type LogRow } from "../data/describe.js";
import { REPLAY_STATUS_DETAIL } from "../data/payout-replay.js";
import { type RunView, showcaseView } from "../data/run-view.js";
import { RunLog } from "../features/fanout/RunLog.js";
import { findRow, lineScreenState } from "../features/print/model.js";
import { PrintStatement } from "../features/print/PrintStatement.js";
import { heroPaymentLanded } from "./personas.js";

const snapshot = getSnapshot();

const itemEvent = (
  to: PayoutItemStatus,
  provenance: RunEvent["provenance"],
  memberNo = "M-014",
  id = "1",
): RunEvent =>
  ({
    id,
    ws: "test",
    runId: snapshot.run.id,
    at: "2026-11-01T00:00:00Z",
    type: "item.updated",
    provenance,
    actor: { kind: "paypal", id: "simulator", impersonatedBy: null },
    payload: {
      itemId: "i",
      rank: 2,
      senderItemId: `r37-${memberNo}`,
      memberNo,
      from: "PENDING",
      to,
      payoutItemId: "PI-1",
      eventId: null,
      source: "status_check",
    },
  }) as RunEvent;

describe("the stage's MM-1 raise", () => {
  it("inv.i8.rises only for M-014's landed payment, never for a replayed SUCCESS", () => {
    expect(heroPaymentLanded(itemEvent("SUCCESS", "simulated_rail"))).toBe(true);
    expect(heroPaymentLanded(itemEvent("SUCCESS", "replay"))).toBe(false);
    expect(heroPaymentLanded(itemEvent("SUCCESS", "simulated_rail", "M-002"))).toBe(false);
    expect(heroPaymentLanded(itemEvent("PENDING", "simulated_rail"))).toBe(false);
  });
});

describe("the run log", () => {
  it.each(["SUBMITTED", "PENDING", "FAILED", "BLOCKED", "ONHOLD"] as const)(
    "inv.i8.a live %s row reads its item word, the brand in its own casing",
    (to) => {
      const row = describeEvent(itemEvent(to, "simulated_rail"), describeContext(snapshot));
      expect(row?.words).toContain(PAYOUT_ITEM_STATUS_LABELS[to].en);
      expect(row?.words).toContain("Simulated PayPal sandbox");
      expect(row?.words).not.toMatch(/paypal sandbox|Needs action|\bparked\b/);
      if (to === "PENDING") expect(row?.words).not.toMatch(/\bSent\b/);
    },
  );

  it("inv.i8.says the replay note once for the whole log, not on every replayed row", () => {
    const ctx = describeContext(snapshot);
    const rows = [
      describeEvent(itemEvent("SUCCESS", "replay", "M-014", "1"), ctx),
      describeEvent(itemEvent("SUCCESS", "replay", "M-002", "2"), ctx),
      describeEvent(itemEvent("UNCLAIMED", "replay", "M-031", "3"), ctx),
    ].filter((row): row is LogRow => row !== null);
    const { container } = render(
      <UiProvider>
        <RunLog rows={rows} isLive={() => false} seeded={false} />
      </UiProvider>,
    );
    const note = rows[0]?.replayNote ?? "";
    expect(note).toMatch(/simulated/);
    expect(container.textContent?.split(note).length).toBe(2);
    expect(container.textContent).toContain("Replayed (labelled): Rhea Jumawan parked");
  });
});

describe("the member's 80 mm paper", () => {
  const paper = (state: MemberLineState, replayed = false) => {
    const base = showcaseView(snapshot);
    const line = base.lines["M-014"];
    if (!line) throw new Error("M-014 required");
    const view: RunView = {
      ...base,
      lines: { ...base.lines, "M-014": { ...line, state } },
      items: Object.fromEntries(
        Object.entries(base.items).map(([id, item]) => [
          id,
          replayed ? { ...item, provenance: "replay" as const } : item,
        ]),
      ),
    };
    const row = findRow(snapshot, view, "M-014");
    const member = snapshot.members.find((m) => m.memberNo === "M-014");
    if (!row || !member) throw new Error("M-014 required");
    const { container } = render(
      <UiProvider>
        <PrintStatement
          snapshot={snapshot}
          view={view}
          member={member}
          row={row}
          state={lineScreenState(view, row)}
        />
      </UiProvider>,
    );
    return container.textContent ?? "";
  };

  it.each([
    ["UNCLAIMED", "Not received through PayPal (Simulated PayPal sandbox)"],
    ["NEEDS_ACTION", "PayPal didn’t complete it (Simulated PayPal sandbox)"],
    ["LOCKED", "Sent, waiting for PayPal (Simulated PayPal sandbox)"],
  ] as const)("inv.i8.prints %s in the member's own words, labelled simulated", (state, words) => {
    const text = paper(state);
    expect(text).toContain(words);
    expect(text).not.toMatch(/\bParked\b|Needs action|\bSent\b(?!,)/);
  });

  it("inv.i8.prints a replayed line's word and its detail once", () => {
    const text = paper("PAID", true);
    expect(text).toContain("Replayed (labelled): successful in the earlier run");
    expect(text.split(REPLAY_STATUS_DETAIL).length).toBe(2);
    expect(text).not.toMatch(/Paid through/);
  });
});
