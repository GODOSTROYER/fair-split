// W-TR-08 Run against the mock world: MM-6, "Honest fan-out". Before the 201 nothing is drawn; PayPal's 201
// draws the threads to 70% (sent); seven verified SUCCESS events land jade; Rhea's UNCLAIMED parks in canary
// with a decision, never red; "Pay in cash at the bodega" retracts her thread into the cash band; a repeated
// delivery logs one row and moves nothing. Full and reduced motion reach the same phases.

import type { RunEvent } from "@fairsplit/contracts";
import { webRoutes } from "@fairsplit/contracts";
import { tagBudget } from "@fairsplit/ui-web";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../../data/query.js";
import { applyRunEvent, type RunView } from "../../data/run-view.js";
import { cashDayForRun } from "../../features/split/shared/run-data.js";
import { format } from "../../lib/format.js";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  renderConsole,
  seedSnapshot,
  tracedPhases,
} from "../../test/index.js";

const RUN = "2026A-r37";
const SLOW = 120_000;
const WAIT = { timeout: 8_000 };

const stateOf = () => screen.queryByTestId("W-TR-08")?.dataset.state;
/** The money bar's legend rows, as their text: name, count, note and amount run together. */
const legend = () =>
  [...screen.getByTestId("W-TR-08.share").querySelectorAll(".fsr-money__row")].map((r) => r.textContent);
const toneOf = (memberNo: string) => screen.getByTestId(`W-TR-08.thread.${memberNo}`).dataset.tone;

async function approved(motion: "full" | "reduced" = "full") {
  const view = await renderConsole({
    path: webRoutes.fanout(RUN),
    viewport: { width: 1920 },
    motion,
  });
  await view.startSession();
  act(() => {
    view.world.markPaid();
    view.world.resolveAll();
    view.world.sign("treasurer");
  });
  await waitFor(
    () => expect(screen.getByTestId("W-TR-08.status").textContent).toMatch(/Not posted yet/),
    WAIT,
  );
  return view;
}

describe("W-TR-08 run: the honest fan-out", () => {
  it(
    "waits for the batch, then the 201 sends eight threads, seven land jade and Rhea parks in canary",
    async () => {
      clearMomentTrace();
      const view = await approved();
      expect(toneOf("M-014")).toBe("unsent");
      const day = () => {
        const run = view.runtime.client.getQueryData<RunView>(queryKeys.run(RUN));
        if (!run) throw new Error("fixture has no run");
        return format.dateShort(cashDayForRun(seedSnapshot(), run));
      };
      // Before the keys: the batch is still to send; the bar's one tag says the rail.
      expect(legend()).toEqual(["To send8US$368.39", `Cash at the bodega56due ${day()}US$3,849.78`]);
      expect(screen.getByTestId("W-TR-08.share").textContent).toContain("Simulated PayPal sandbox");
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(stateOf()).toBe("parked"), WAIT);
      await waitFor(() => expect(tracedPhases("MM-6")).toContain("parked"), WAIT);
      expect(tracedPhases("MM-6")).toEqual(expect.arrayContaining(["sent", "landing", "parked"]));
      for (const m of ["M-014", "M-007", "M-060", "M-018", "M-039", "M-022", "M-002"])
        expect(toneOf(m)).toBe("landed");
      expect(toneOf("M-031")).toBe("parked");
      // The top bar's Proof counter counts Proof's six checks (round 3), not payouts: none checked yet.
      expect(screen.getByTestId("W-JG-01.proofChip").textContent).toContain("Proof: 0 of 6 checks match");
      // Signature 6: one seal, 64 lines, eight PayPal threads and 56 cash members, each its own path, the cash
      // drawn solid so the 56 meet as one calm band.
      const fan = screen.getByTestId("W-TR-08.fan");
      expect(fan.querySelectorAll("path.fsr-fan__thread")).toHaveLength(8);
      const cash = fan.querySelectorAll<SVGPathElement>("path.fsr-fan__cash-line");
      expect(cash).toHaveLength(56);
      expect(
        [...cash].every((p) => p.getAttribute("pathLength") === "1" && !p.getAttribute("stroke-dasharray")),
      ).toBe(true);
      // The words are HTML at their type sizes, never SVG text scaled with the picture.
      expect(fan.querySelectorAll("text")).toHaveLength(0);
      const celing = screen.getByTestId("W-TR-08.label.M-014");
      expect(celing.textContent).toBe("Consolacion BacusUS$64.45");
      expect(celing.querySelector(".fsr-fan__name")?.textContent).toBe("Consolacion Bacus");
      expect(celing.querySelector(".fs-t-figure")?.getAttribute("data-amount-state")).toBe("landed");
      // Rhea's path runs on to her own marker, which turns marigold: nothing floats in mid-air (round 3).
      expect(screen.queryByTestId("W-TR-08.chip.M-031")).toBeNull();
      const rheaThread = screen.getByTestId("W-TR-08.thread.M-031");
      expect(
        rheaThread.querySelector<SVGPathElement>(".fsr-fan__thread")?.style.getPropertyValue("--fsr-p"),
      ).toBe("1");
      expect(rheaThread.querySelector("circle")).toBeNull();
      // The cash route is one hatched ribbon: the 56 shares draw under one hatch mask.
      const ribbon = screen.getByTestId("W-TR-08.ribbon");
      expect(ribbon.getAttribute("mask")).toMatch(/^url\(#/);
      expect(ribbon.querySelectorAll("path.fsr-fan__cash-line")).toHaveLength(56);
      // The run's one dot-matrix count, and the one micro-tag on its money: the top bar's indicator is the third.
      expect(screen.getByTestId("W-TR-08.count").getAttribute("data-value")).toBe("7/8");
      expect(tagBudget(screen.getByTestId("W-TR-08"))).toMatchObject({ tags: 1, micro: 1, ok: true });
      const run = view.runtime.client.getQueryData<RunView>(queryKeys.run(RUN));
      if (!run) throw new Error("fixture has no run");
      const cashDay = format.dateShort(cashDayForRun(seedSnapshot(), run));
      expect(screen.getByTestId("W-TR-08.cashLabel").textContent).toBe(
        "56 members · cash at the bodegaUS$3,849.78",
      );
      const rhea = screen.getByTestId("W-TR-08.parked");
      expect(rhea.textContent).toMatch(/Rhea JumawanUS\$26\.65/);
      expect(rhea.textContent).toMatch(/No PayPal account · unclaimed · returns to the co-op in 30 days/);
      // The run's instrument and the money bar say what the stage's Proof counter says: confirmed, parked, cash.
      expect(screen.getByTestId("W-TR-08.status").textContent).toBe("7/8confirmed1 needs you");
      expect(legend()).toEqual([
        "Confirmed7US$341.74",
        "Parked1US$26.65",
        `Cash at the bodega56due ${cashDay}US$3,849.78`,
      ]);
      expect(screen.queryByTestId("W-TR-08.denied")).toBeNull();
      const log = screen.getByTestId("W-TR-08.lane.PAYPAL");
      expect(within(log).getAllByText(/^Paid /)).toHaveLength(7);
      expect(screen.getByTestId("W-TR-08.latency.summary").textContent).toMatch(/^median .+ · slowest .+/);
      await expectNoAxeViolations(screen.getByTestId("W-TR-08"));
    },
    SLOW,
  );

  it(
    "Pay in cash at the bodega: her thread retracts into the band, 7 of 64 on PayPal, settled with no celebration",
    async () => {
      clearMomentTrace();
      const view = await approved();
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(stateOf()).toBe("parked"), WAIT);
      const face = screen.getByTestId("W-TR-08.payCash.face");
      face.focus();
      fireEvent.keyDown(face, { key: "Enter" });
      await waitFor(() => expect(stateOf()).toBe("done"), WAIT);
      expect(toneOf("M-031")).toBe("moved");
      // The slab went with the parked card: focus is on the line that says where her cash is, never on <body>.
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("W-TR-08.rerouted")), WAIT);
      // Her thread retracts and her own dashed cash line draws in from the same slot (live, so it animates).
      const line = screen.getByTestId("W-TR-08.cash.M-031");
      expect(line.dataset.moved).toBe("");
      expect(line.closest(".fsr-fan__moved")?.hasAttribute("data-animate")).toBe(true);
      expect(
        screen
          .getByTestId("W-TR-08.thread.M-031")
          .querySelector(".fsr-fan__thread")
          ?.hasAttribute("data-animate"),
      ).toBe(true);
      const fan = screen.getByTestId("W-TR-08.fan");
      expect(fan.querySelectorAll("path.fsr-fan__cash-line")).toHaveLength(57);
      expect(screen.getByTestId("W-TR-08.label.M-031").textContent).toBe("Rhea Jumawan → cash");
      expect(screen.getByTestId("W-TR-08.cashLabel").textContent).toMatch(/^57 members · cash at the bodega/);
      expect(screen.queryByTestId("W-TR-08.chip.M-031")).toBeNull();
      const run = view.runtime.client.getQueryData<RunView>(queryKeys.run(RUN));
      if (!run) throw new Error("fixture has no run");
      const cashDay = format.dateShort(cashDayForRun(seedSnapshot(), run));
      expect(legend()).toEqual([
        "Confirmed7US$341.74",
        `Cash at the bodega57due ${cashDay}US$3,876.43`,
        "Kept for membersUS$21.14",
      ]);
      // Settled routing, not settled cash: seven of eight confirmed on PayPal, and apart from them, in neutral with
      // its hatch, the 57 members' cash still due on its day.
      expect(screen.getByTestId("W-TR-08.status").textContent).toBe(
        `7/8confirmed on PayPal57 cash due ${cashDay}`,
      );
      expect(screen.getByTestId("W-TR-08.cashDue").textContent).toBe(`57 cash due ${cashDay}`);
      expect(screen.getByTestId("W-TR-08.rerouted").textContent).toBe(
        `Rhea Jumawan → cash at the bodegadue ${cashDay}`,
      );
      await waitFor(() => expect(tracedPhases("MM-6").slice(-1)[0]).toBe("settled"), WAIT);
      expect(tracedPhases("MM-6")).toEqual(expect.arrayContaining(["parked", "rerouted", "settled"]));
      // The log never says "Settled" while the 57 members' cash is due: PayPal is complete, the cash is not.
      const log = screen.getByTestId("W-TR-08.log");
      await waitFor(() =>
        expect(within(log).getAllByText("PayPal complete · cash due").length).toBeGreaterThan(0),
      );
      expect(within(log).queryAllByText("Settled")).toHaveLength(0);
      expect(view.world.line("M-031")?.state).toBe("OFF_RAIL_DUE");
    },
    SLOW,
  );

  it(
    "a repeated delivery logs one quiet row and changes nothing else",
    async () => {
      const view = await approved();
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(stateOf()).toBe("parked"), WAIT);
      // The live UNCLAIMED plays MM-6's "parked" act once the director gives it the stage: wait for that act to
      // be traced before clearing, so the check below sees only what the repeated delivery does.
      await waitFor(() => expect(tracedPhases("MM-6")).toContain("parked"), WAIT);
      clearMomentTrace();
      const tonesBefore = ["M-014", "M-031"].map(toneOf);
      act(() => {
        view.runtime.client.setQueryData<RunView>(queryKeys.run(RUN), (old) => {
          const last = old?.events.at(-1);
          if (!old || !last) return old;
          const duplicate = {
            ...last,
            id: String(Number(old.lastEventId) + 1),
            type: "webhook.received",
            at: new Date().toISOString(),
            actor: { kind: "paypal", id: "paypal:webhook", impersonatedBy: null },
            provenance: "simulated_rail",
            payload: {
              webhookEventId: "wh-repeat-1",
              paypalEventId: "WH-MOCK-REPEAT",
              eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
              verified: "self",
              duplicate: true,
            },
          } as unknown as RunEvent;
          return applyRunEvent(old, duplicate);
        });
      });
      const row = await screen.findByTestId("W-TR-08.log.duplicate");
      expect(row.textContent).toMatch(/Delivery repeated, already applied\./);
      expect(["M-014", "M-031"].map(toneOf)).toEqual(tonesBefore);
      expect(stateOf()).toBe("parked");
      // No act starts: the only phase MM-6 may trace is the resting "parked" it already holds (under load the
      // live UNCLAIMED's own act can still be landing on it when the trace is cleared).
      expect(tracedPhases("MM-6").filter((phase) => phase !== "parked")).toEqual([]);
    },
    SLOW,
  );

  it(
    "reduced motion reaches the same phases",
    async () => {
      clearMomentTrace();
      const view = await approved("reduced");
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(stateOf()).toBe("parked"), WAIT);
      await waitFor(() => expect(tracedPhases("MM-6")).toContain("parked"), WAIT);
      expect(screen.getByTestId("W-TR-08.fan").dataset.motion).toBe("reduced");
      expect(tracedPhases("MM-6")).toEqual(expect.arrayContaining(["sent", "landing", "parked"]));
    },
    SLOW,
  );

  it(
    "the showcase run is done, its log labelled seeded; PayPal declining a batch is the only red",
    async () => {
      const view = await renderConsole({ path: webRoutes.fanout(RUN), viewport: { width: 1920 } });
      await waitFor(() => expect(stateOf()).toBe("done"), WAIT);
      expect(screen.getByTestId("W-TR-08.log").textContent).toMatch(/Seeded showcase history/);
      expect(toneOf("M-031")).toBe("moved");
      // History is drawn in place: her cash line is there, still.
      expect(
        screen.getByTestId("W-TR-08.cash.M-031").closest(".fsr-fan__moved")?.hasAttribute("data-animate"),
      ).toBe(false);
      await expectNoAxeViolations(screen.getByTestId("W-TR-08"));
      act(() => {
        view.runtime.client.setQueryData<RunView>(queryKeys.run(RUN), (old) =>
          old ? { ...old, state: "DENIED" } : old,
        );
      });
      await waitFor(() => expect(stateOf()).toBe("denied"), WAIT);
      expect(screen.getByTestId("W-TR-08.denied").dataset.tone).toBe("red");
    },
    SLOW,
  );
});

it("shows the paced cancellation delay and retries payCash once before moving Rhea to cash", async () => {
  let attempts = 0;
  const view = await renderConsole({
    path: webRoutes.fanout(RUN),
    motion: "reduced",
    handlers: [
      http.post("*/v1/lines/:lineId/pay-cash", () => {
        attempts++;
        return attempts === 1
          ? HttpResponse.json(
              { code: "QUEUED", status: 429, message: "Cancellation paced", retryAfterMs: 700 },
              { status: 429 },
            )
          : undefined;
      }),
    ],
  });
  await view.startSession();
  act(() => {
    view.world.markPaid();
    view.world.resolveAll();
    view.world.sign("treasurer");
    view.world.cosign();
  });
  await waitFor(() => expect(stateOf()).toBe("parked"), WAIT);
  fireEvent.keyDown(screen.getByTestId("W-TR-08.payCash.face"), { key: "Enter" });
  await waitFor(() =>
    expect(screen.getByTestId("W-TR-08.queued").textContent).toBe("You're next, about 1 s"),
  );
  await waitFor(() => expect(stateOf()).toBe("done"), WAIT);
  expect(attempts).toBe(2);
  expect(view.world.line("M-031")?.state).toBe("OFF_RAIL_DUE");
  expect(screen.queryByTestId("W-TR-08.queued")).toBeNull();
  expect(screen.queryByTestId("W-TR-08.error")).toBeNull();
});

it("inv.i8.keeps Rhea’s cash status when the payout items replayed", async () => {
  const rendered = await renderConsole({ path: webRoutes.fanout(RUN), motion: "reduced" });
  await waitFor(() => expect(stateOf()).toBe("done"), WAIT);
  act(() => {
    rendered.runtime.client.setQueryData<RunView>(queryKeys.run(RUN), (old) => {
      if (!old) return old;
      return {
        ...old,
        events: [
          {
            id: "999",
            ws: "test",
            runId: old.runId,
            type: "item.updated",
            provenance: "replay",
            at: "2026-11-01T00:00:00Z",
            actor: { kind: "paypal", id: "simulator", impersonatedBy: null },
            payload: {
              memberNo: "M-014",
              senderItemId: "r37-M-014",
              from: "PENDING",
              to: "SUCCESS",
              payoutItemId: "RPLY-test",
              eventId: null,
              source: "status_check",
            },
          } as RunEvent,
        ],
      };
    });
  });
  await waitFor(() =>
    expect(screen.getByTestId("W-TR-08.table").textContent).toContain("Replayed (labelled)"),
  );
  const table = screen.getByTestId("W-TR-08.table");
  const cash = within(table)
    .getByRole("rowheader", { name: /Rhea Jumawan/ })
    .closest("tr");
  expect(cash?.textContent).toContain("Cash due");
  expect(cash?.textContent).not.toContain("Replayed");
  expect(table.textContent).toContain("Replayed (labelled)");
});
