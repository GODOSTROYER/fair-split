import { getSnapshot } from "@fairsplit/api-client/seed";
import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { nextStep } from "../chrome/next-step.js";
import { applyRunEvent, emptyRunView, type RunView } from "../data/run-view.js";
import { BrandHeader } from "../features/brand/BrandHeader.js";
import { FIGURE_COPY } from "../features/proof/copy.js";
import { countItems } from "../features/proof/model.js";
import { APPROVE } from "../features/split/shared/copy.js";
import { hourlyCapSession } from "../test/quota.js";
import { renderConsole } from "../test/render.js";
import { createTestWorld } from "../test/world.js";
import { FramePoster } from "./FramePoster.js";
import { personaStatus } from "./personas.js";

const snapshot = getSnapshot();
const RUN = snapshot.run.runSlug;
const replayEvent = {
  id: "9999",
  ws: "test",
  runId: snapshot.run.id,
  at: "2026-11-01T00:00:00Z",
  type: "item.updated",
  provenance: "replay",
  actor: { kind: "paypal", id: "simulator", impersonatedBy: null },
  payload: {
    senderItemId: "r37-M-014",
    memberNo: "M-014",
    from: "PENDING",
    to: "SUCCESS",
    payoutItemId: "RPLY-test",
    eventId: null,
    source: "status_check",
  },
} as RunView["events"][number];

it.each(["replay", "simulated_rail"] as const)(
  "inv.i8.member poster and phone words label %s paid evidence",
  (provenance) => {
    const base = emptyRunView(RUN, "session");
    const view = applyRunEvent(
      {
        ...base,
        lines: {
          ...base.lines,
          "M-014": {
            memberNo: "M-014",
            state: "PAID",
            lineId: null,
            changedBy: "paypal",
            eventId: null,
            at: null,
          },
        },
      } as RunView,
      { ...replayEvent, provenance },
    );
    render(<FramePoster persona="member" view={view} snapshot={snapshot} asleep={false} />);
    const poster = screen.getByTestId("W-JG-01.poster.member");
    expect(poster.textContent).toContain("Simulated PayPal sandbox");
    expect(personaStatus("member", view)).toMatch(/simulated PayPal sandbox/i);
    if (provenance === "replay") {
      expect(poster.textContent).toMatch(/replay/i);
      expect(personaStatus("member", view)).toMatch(/replay/i);
      expect(poster.querySelector('[data-state="paid"]')).toBeNull();
      expect(poster.querySelector('.fs-amount[data-state="hollow"]')).not.toBeNull();
      expect(poster.querySelector(".fs-capsule")?.getAttribute("lang")).toBe("en");
    } else {
      expect(poster.textContent).not.toMatch(/replay/i);
      expect(personaStatus("member", view)).not.toMatch(/replay/i);
    }
  },
);

it("inv.i8.brand payout summary labels replayed statuses", () => {
  render(
    <BrandHeader
      state="progress"
      snapshot={snapshot}
      bundle={snapshot.proof}
      invoiceStatus="MARKED_AS_PAID"
      invoiceNumber="test"
      progress={countItems(snapshot.proof.batch.items.map((item) => item.status))}
      returnedCashPaid={0}
      posted
      rail="simulator"
      provenance="simulated PayPal sandbox"
      payoutReplayed
    />,
  );
  expect(screen.getByTestId("W-BR-01.payouts").textContent).toContain("payout statuses replayed (labelled)");
  expect(screen.getByTestId("W-BR-01.payouts").textContent).not.toContain("confirmed by");
});

it("inv.i8.replay SUCCESS never paints the Log's confirmed jade", async () => {
  const rendered = await renderConsole({ path: "/judge" });
  await rendered.startSession();
  act(() =>
    rendered.runtime.client.setQueryData<RunView>(["run", RUN], (view) =>
      view ? applyRunEvent(view, replayEvent) : view,
    ),
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("W-JG-01.logOpen"));
  });
  const paypal = () => within(screen.getByTestId("W-JG-01.log")).getAllByTestId("W-JG-01.log.paypal")[0];
  await waitFor(() => expect(paypal()?.textContent).toContain("Replayed"));
  expect(paypal()?.hasAttribute("data-landed")).toBe(false);
  expect(paypal()?.textContent).not.toContain("SUCCEEDED");
});

it("inv.i8.remaining retry and due copy names the simulated rail", () => {
  expect(APPROVE.paypalRetrying(1, 3)).toContain("simulated PayPal sandbox");
  expect(FIGURE_COPY.dueNote(1, 1)).toContain("simulated PayPal sandbox");
  expect(
    nextStep(
      { ...emptyRunView(RUN, "session"), state: "DENIED" },
      { inSession: true, season: "2026-A", recordedOn: "29 Oct", byHandSlip: "0462", payouts: 8 },
    ).text,
  ).toContain("simulated PayPal sandbox");
});

it("inv.i8.posted live Stage and Proof keep confirmations when the session quota is hourly_cap", async () => {
  const world = createTestWorld();
  let quotaReads = 0;
  const quota = hourlyCapSession(world, { runState: "INVOICED", onRead: () => quotaReads++ });
  const rendered = await renderConsole({ path: webRoutes.fanout(RUN), world, handlers: [quota] });
  await rendered.startSession();
  await waitFor(() =>
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toContain(
      "This run’s PayPal payouts will replay",
    ),
  );
  act(() => {
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
  });
  // The Proof counter counts Proof's six checks (round 3): live payouts never read as replayed there either.
  await waitFor(() => expect(screen.getByTestId("W-TR-08.share").textContent).toMatch(/confirmed/i));
  expect(screen.getByTestId("W-JG-01.proofChip").textContent).toContain("Proof: 0 of 6 checks match");
  expect(screen.getByTestId("W-JG-01.proofChip").textContent).not.toMatch(/replay/i);
  await waitFor(() => expect(quotaReads).toBeGreaterThan(0));
  expect(screen.getByTestId("W-TR-08.share").textContent).not.toMatch(/replay/i);
  expect(screen.getByTestId("W-TR-08.table").textContent).not.toMatch(/replay/i);
  expect(screen.queryByTestId("W-JG-01.notice.state")).toBeNull();
  await rendered.navigate(webRoutes.proof(RUN));
  await waitFor(() =>
    expect(screen.getByTestId("W-PF-01.progress").textContent).toContain(
      "confirmed in the simulated sandbox",
    ),
  );
  expect(screen.getByTestId("W-PF-01.progress").textContent).not.toMatch(/replay/i);
  expect(screen.getByTestId("W-PF-01.footer").textContent).not.toMatch(/replay/i);
}, 30000);

it("inv.i8.Stage receives posted session state while history is still pre-POST", async () => {
  const world = createTestWorld();
  const quota = hourlyCapSession(world, { runState: "SETTLED" });
  const rendered = await renderConsole({ path: "/judge", world, handlers: [quota] });
  await rendered.startSession();
  await waitFor(() =>
    expect(
      rendered.runtime.client
        .getQueriesData({ queryKey: ["judge-session-status"] })
        .find(([, data]) => data !== undefined)?.[1],
    ).toBeDefined(),
  );
  expect(screen.queryByTestId("W-JG-01.notice.state")).toBeNull();
});
