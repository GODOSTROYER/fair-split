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
const toneOf = (memberNo: string) => screen.getByTestId(`W-TR-08.thread.${memberNo}`).dataset.tone;
/** The run's state chip on its title row (round 5). */
const chipText = () => screen.getByTestId("W-TR-08.stateChip").textContent;

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
      // Before the keys: the batch is still to send; the run's one tag says the rail, and the fan's rows the amounts
      // (round 5: no money bar restates them).
      expect(screen.getByTestId("W-TR-08.share").textContent).toContain("Simulated PayPal sandbox");
      expect(chipText()).toBe("Not posted");
      expect(screen.getByTestId("W-TR-08.cashLabel").textContent).toBe(
        "56 members · cash at the bodegaUS$3,849.78",
      );
      expect(
        screen.getByTestId("W-TR-08.cashLabel").querySelector(".fsr-fan__name")?.getAttribute("title"),
      ).toBe(`due ${day()}`);
      expect(screen.getByTestId("W-TR-08").querySelector(".fsr-money")).toBeNull();
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
      // Rhea's path runs on to her own marker, which turns marigold: nothing floats in mid-air (round 3). Round 5:
      // every line ends on a round marker (the one vocabulary's dot), never a square; her one circle is that marker.
      expect(screen.queryByTestId("W-TR-08.chip.M-031")).toBeNull();
      const rheaThread = screen.getByTestId("W-TR-08.thread.M-031");
      expect(
        rheaThread.querySelector<SVGPathElement>(".fsr-fan__thread")?.style.getPropertyValue("--fsr-p"),
      ).toBe("1");
      expect(rheaThread.querySelectorAll("circle")).toHaveLength(1);
      expect(rheaThread.querySelector("circle")?.classList.contains("fsr-fan__stub-face")).toBe(true);
      expect(fan.querySelectorAll("circle.fsr-fan__stub-face")).toHaveLength(8);
      expect(fan.querySelectorAll("rect.fsr-fan__stub-face")).toHaveLength(0);
      // The cash route is one hatched ribbon: the 56 shares draw under one hatch mask.
      const ribbon = screen.getByTestId("W-TR-08.ribbon");
      expect(ribbon.getAttribute("mask")).toMatch(/^url\(#/);
      expect(ribbon.querySelectorAll("path.fsr-fan__cash-line")).toHaveLength(56);
      // The run's one hero count in FS Sans, and the one micro-tag on its money: the top bar's indicator is the third.
      expect(screen.getByTestId("W-TR-08.count").getAttribute("data-value")).toBe("7/8");
      expect(screen.getByTestId("W-TR-08.count").classList.contains("fs-t-hero")).toBe(true);
      expect(screen.getByTestId("W-TR-08").querySelector(".fs-dm, [data-dot-matrix]")).toBeNull();
      expect(tagBudget(screen.getByTestId("W-TR-08"))).toMatchObject({ tags: 1, micro: 1, ok: true });
      expect(screen.getByTestId("W-TR-08.cashLabel").textContent).toBe(
        "56 members · cash at the bodegaUS$3,849.78",
      );
      expect(
        screen.getByTestId("W-TR-08.cashLabel").querySelector(".fsr-fan__name")?.getAttribute("title"),
      ).toBe(`due ${day()}`);
      const rhea = screen.getByTestId("W-TR-08.parked");
      // Round 7: the parked reason is the second line of her own fan row (no card repeats her under the fan); her
      // name and amount are its heading for assistive technology, and the primary names whose payment it is.
      expect(rhea.closest(".fsr-fan__note")).not.toBeNull();
      expect(rhea.querySelector("h3.fs-sr")?.textContent).toBe("Parked · Rhea Jumawan · US$26.65");
      expect(rhea.textContent).toMatch(/No PayPal account · returns in 30 days/);
      // Round 8: the action is named for what it does (her line moves to the cash list; nobody is paid by it).
      expect(screen.getByTestId("W-TR-08.payCash.face").textContent).toContain(
        "Move Rhea to cash at the bodega",
      );
      expect(screen.getByTestId("W-TR-08.payCash.face").textContent).not.toMatch(/\bPay\b/);
      // The run's count with its one micro-tag beside it; that a person must decide is the run's state, said once
      // on the title row (round 5). No money bar restates the fan.
      const count = screen.getByTestId("W-TR-08.status").querySelector(".fsr-fanout__instrument");
      expect(count?.textContent).toBe("7/8confirmedSimulatedSimulated PayPal sandbox");
      expect(count?.querySelector('[data-testid="W-TR-08.tag"]')).toBeTruthy();
      expect(chipText()).toBe("1 needs you");
      expect(screen.getByTestId("W-TR-08.stateChip").dataset.tone).toBe("canary");
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Run 2026-A");
      expect(screen.getByTestId("W-TR-08.head.provenance").textContent).toContain(
        "Synthetic co-op · simulated PayPal",
      );
      expect(screen.getByTestId("W-TR-08").querySelector(".fsr-money")).toBeNull();
      expect(screen.queryByTestId("W-TR-08.denied")).toBeNull();
      const log = screen.getByTestId("W-TR-08.lane.PAYPAL");
      expect(within(log).getAllByText(/^Paid /)).toHaveLength(7);
      // The log shows four rows and "All N events" (round 5), with no legend glyph; a confirmed payment's lane dot
      // is jade, every other PayPal row a hollow ring.
      const runLog = screen.getByTestId("W-TR-08.log");
      expect(runLog.querySelectorAll(".fsr-log__latest > li")).toHaveLength(4);
      expect(runLog.querySelectorAll("[data-fs-glyph]")).toHaveLength(0);
      expect(runLog.closest(".fsc-peek")).toBeTruthy();
      // Round 8: the strip says what it measures and whose timings they are, then the median.
      expect(screen.getByTestId("W-TR-08.latency").querySelector("figcaption")?.textContent).toBe(
        "Invoice paid to payout confirmed",
      );
      expect(screen.getByTestId("W-TR-08.latency.summary").textContent).toMatch(
        /^This run · 7 simulated payouts · median \d/,
      );
      expect(screen.getByTestId("W-TR-08.latency").textContent).not.toMatch(/slowest/);
      expect(tagBudget(screen.getByTestId("W-TR-08")).glyphs).toBe(0);
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
      // The slab went with the parked card: focus is on the run's hero or its next action, never on <body>.
      await waitFor(
        () =>
          expect(["W-TR-08.status", "W-TR-08.cashReview"]).toContain(
            document.activeElement?.getAttribute("data-testid"),
          ),
        WAIT,
      );
      // Her thread retracts and her own thin cash line draws in from the same slot (live, so it animates).
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
      // Round 5: her row keeps her amount, in ink-3 behind the hatch swatch (it rides with the cash now).
      const rheaRow = screen.getByTestId("W-TR-08.label.M-031");
      // Round 8: the row says the cash is still due, never that she was paid.
      expect(rheaRow.textContent).toMatch(/^Rhea Jumawan · cash due \d{1,2} [A-Z][a-z]{2}US\$26\.65$/);
      expect(rheaRow.querySelector('[data-amount-state="moved"] .fs-swatch[data-kind="cash"]')).toBeTruthy();
      expect(screen.getByTestId("W-TR-08.cashLabel").textContent).toMatch(
        /^57 members · cash at the bodegaUS\$3,876\.43/,
      );
      // Round 8: no "Kept for members" caption on Run (Proof explains what the holds kept); no bar or legend.
      expect(screen.queryByTestId("W-TR-08.kept")).toBeNull();
      expect(screen.getByTestId("W-TR-08").textContent).not.toMatch(/Kept for members/);
      expect(screen.getByTestId("W-TR-08").querySelector(".fsr-money")).toBeNull();
      expect(screen.queryByTestId("W-TR-08.chip.M-031")).toBeNull();
      const run = view.runtime.client.getQueryData<RunView>(queryKeys.run(RUN));
      if (!run) throw new Error("fixture has no run");
      const cashDay = format.dateShort(cashDayForRun(seedSnapshot(), run));
      // Settled routing, not settled cash (rounds 4 and 5): the hero is the two outcomes, "7 PayPal  57 cash", a 12 px
      // jade dot before "PayPal" and a 12 px hatch swatch before "cash", 32 px apart (no "·"), never "7/8" after her
      // move to cash; the cash's day on its baseline, "Review cash handover" under it as the screen's one primary,
      // and "PayPal complete · cash due" as the run's state on the title row.
      const status = screen.getByTestId("W-TR-08.status");
      const settled = screen.getByTestId("W-TR-08.settled");
      // Round 7: each count carries its own qualifier under its word, so the cash's day never leaves the cash.
      expect(
        [...settled.querySelectorAll(".fsr-fanout__part")]
          .map((part) =>
            [
              part.querySelector(".fsr-fanout__count")?.textContent,
              part.querySelector(".fsr-fanout__key")?.textContent,
            ].join(""),
          )
          .join(" ")
          .replace(/\s+/g, " "),
      ).toBe("7PayPal 57cash");
      expect(screen.getByTestId("W-TR-08.cashDue").closest(".fsr-fanout__part")?.textContent).toMatch(
        /^57cash/,
      );
      expect(screen.getByTestId("W-TR-08.tag").closest(".fsr-fanout__part")?.textContent).toMatch(/^7PayPal/);
      expect(screen.getByTestId("W-TR-08.count").getAttribute("data-value")).toBe("7");
      expect(status.textContent).not.toMatch(/7\/8/);
      expect(status.querySelectorAll('.fs-state-dot[data-kind="paid"][data-size="12"]')).toHaveLength(1);
      expect(settled.querySelectorAll('.fsr-fanout__swatch[data-kind="cash"][data-size="12"]')).toHaveLength(
        1,
      );
      expect(chipText()).toBe("PayPal complete · cash due");
      expect(screen.getByTestId("W-TR-08.stateChip").dataset.tone).toBe("hatch");
      expect(status.querySelector(".fs-sr")?.textContent).toMatch(/^7 confirmed on PayPal · 57 in cash/);
      expect(screen.getByTestId("W-TR-08.cashDue").textContent).toBe(`due ${cashDay}`);
      const review = screen.getByTestId("W-TR-08.cashReview");
      expect(review.getAttribute("href")).toBe(webRoutes.proof(RUN));
      expect(review.textContent).toBe("Review cash handover");
      expect(review.closest(".fs-slab")?.getAttribute("data-tone")).toBe("chalk");
      expect(screen.getByTestId("W-TR-08").querySelectorAll(".fs-slab")).toHaveLength(1);
      expect(status.textContent).not.toMatch(/Settled|Done/);
      // Her move to cash is said once: on her row of the fan, never as a line of its own.
      expect(screen.queryByTestId("W-TR-08.rerouted")).toBeNull();
      expect(screen.getByTestId("W-TR-08").textContent?.match(/Rhea Jumawan · cash due/g)).toHaveLength(1);
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
      // The settled hero, and the log and the latency dots on the one grid (columns 1–8 and 9–12).
      expect(screen.getByTestId("W-TR-08.count").getAttribute("data-value")).toBe("7");
      expect(screen.getByTestId("W-TR-08").classList.contains("fsc-screen")).toBe(true);
      expect(screen.getByTestId("W-TR-08.log").closest("[data-span]")?.getAttribute("data-span")).toBe("8");
      expect(screen.getByTestId("W-TR-08.latency").closest("[data-span]")?.getAttribute("data-span")).toBe(
        "4",
      );
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
