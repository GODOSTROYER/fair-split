import { getSnapshot } from "@fairsplit/api-client/seed";
import type { RunEvent } from "@fairsplit/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describeContext, describeEvent } from "../../data/describe.js";
import { createTestWorld } from "../../test/world.js";
import { seededLog } from "../fanout/seeded.js";
import { plateFact } from "./Chain.js";
import { Figures } from "./Figures.js";
import { deriveFigures } from "./metrics.js";
import { countItems, ledgerFacts, mergeItems } from "./model.js";

const snapshot = getSnapshot();
const bundle = snapshot.proof;
const facts = ledgerFacts(bundle.ledger);
const items = mergeItems(bundle.batch.items);

describe("Proof and log copy stays faithful to its evidence", () => {
  it("inv.i8.invoice sentence casing preserves the PayPal brand", () => {
    expect(
      plateFact("paid", {
        bundle,
        facts,
        progress: countItems(items.map((item) => item.status)),
        items,
        lineStates: {},
      }),
    ).toContain("marked as paid in the simulated PayPal sandbox");
  });

  it("inv.i8.replayed timing and every PayPal rail figure are labelled", () => {
    const figures = deriveFigures({ bundle, facts, items, lineStates: {}, holds: null, seeded: null });
    render(
      <Figures
        bundle={bundle}
        figures={{ ...figures, timingMs: null }}
        rail="simulator"
        progressEvent={null}
        fees={null}
        replayed
      />,
    );
    expect(screen.getByTestId("W-PF-01.metric.timing").textContent).toContain("Replayed, no timing");
    expect(screen.getByTestId("W-PF-01.metric.timing").textContent).not.toContain("Still running");
    expect(screen.getByTestId("W-PF-01.metric.timing").textContent).toContain(
      "No timing: payout statuses are replayed from an earlier simulated PayPal sandbox run.",
    );
    expect(screen.getByTestId("W-PF-01.metric.rails").textContent).toMatch(/^On PayPal/);
    expect(screen.getByTestId("W-PF-01.metric.rails").querySelector(".fs-honesty")?.textContent).toBe(
      "Simulated PayPal sandbox",
    );
    expect(screen.getByTestId("W-PF-01.railbar.table").textContent).toContain("PayPal (simulated sandbox)");
  });

  it("inv.i8.early run states describe the replayed invoice and payment step", () => {
    const world = createTestWorld();
    world.markPaid();
    const event = world.events().find((event) => event.type === "run.state");
    if (!event) throw new Error("run state required");
    const row = describeEvent({ ...event, provenance: "replay" }, describeContext(snapshot));
    expect(row?.detail).toBe("Run state, Labelled replay of the simulated invoice and payment step");
    for (const to of ["POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED"] as const) {
      expect(
        describeEvent(
          { ...event, provenance: "replay", payload: { ...event.payload, to } },
          describeContext(snapshot),
        )?.detail,
      ).toBe("Run state, Reached on replayed payout statuses");
    }
  });

  it.each(["CANCELLED", "DENIED", "HALTED"] as const)(
    "inv.i8.%s describes the replay evidence from before the terminal transition",
    (to) => {
      const world = createTestWorld();
      world.markPaid();
      const event = world.events().find((event) => event.type === "run.state");
      if (!event) throw new Error("run state required");
      for (const from of ["INVOICED", "IN_REVIEW", "APPROVED", "POSTING", "SETTLING", "SETTLED"] as const) {
        const row = describeEvent(
          { ...event, provenance: "replay", payload: { ...event.payload, from, to } },
          describeContext(snapshot),
        );
        expect(row?.detail).toBe(
          ["POSTING", "SETTLING", "SETTLED"].includes(from)
            ? "Run state, Reached on replayed payout statuses"
            : "Run state, Labelled replay of the simulated invoice and payment step",
        );
      }
    },
  );

  it("inv.i8.cancelled and seeded returned payouts explicitly name the simulated balance", () => {
    const event: RunEvent = {
      id: "1",
      at: "2026-11-01T00:00:00Z",
      runId: snapshot.run.id,
      ws: "test",
      type: "item.updated",
      actor: { kind: "paypal", id: "simulator", impersonatedBy: null },
      provenance: "simulated_rail",
      payload: {
        itemId: "test-returned",
        rank: 6,
        eventId: null,
        senderItemId: "r1-M-031",
        memberNo: "M-031",
        from: "UNCLAIMED",
        to: "RETURNED",
        payoutItemId: "SIM-RETURNED",
        source: "cancel",
      },
    };
    expect(describeEvent(event, describeContext(snapshot))?.words).toContain("simulated PayPal balance");
    expect(
      seededLog(snapshot, describeContext(snapshot)).find((row) => row.words.includes("returned"))?.words,
    ).toContain("simulated PayPal balance");
  });
});
