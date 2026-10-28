// W-JG-01's first view and "Play it for me": the showcase snapshot with Claude's recorded draft in pencil and no
// calls; the first press starts the session and MM-S plays on the invoice's event (full and reduced); a refusal
// reads in the console's words; autoplay presses with a visible cursor and stops before the keys.

import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearMomentTrace,
  createTestWorld,
  expectNoAxeViolations,
  momentPhase,
  recordRequests,
  renderConsole,
  tracedPhases,
} from "../../test/index.js";
import { autoplayTiming } from "./Autoplay.js";
import { AUTOPLAY_COPY, AUTOPLAY_STEP_MS } from "./autoplay-plan.js";

// These render the whole console over the mock world and run axe on it: on a busy machine that is slow, so they
// wait longer than the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

async function press(testId: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId(`${testId}.face`), { key: "Enter" });
  });
}

describe("W-JG-01 first view", { timeout: 60_000 }, () => {
  it("shows the showcase with no calls: the desk, the bolted card, Claude's draft in pencil, the invoice hollow", async () => {
    // The log is installed before the first render, so it sees anything the page sends while mounting.
    const log = recordRequests();
    const view = await renderConsole({ path: "/judge", handlers: [log.handler] });
    const root = await screen.findByTestId("W-JG-01");
    expect(root.dataset.state).toBe("ready");
    expect(within(root).getByRole("heading", { level: 1 }).textContent).toBe(
      "Season 2026-A is ready to pay.",
    );
    expect(screen.getByTestId("W-JG-01.invoice.amount").dataset.amountState).toBe("hollow");
    expect(screen.getByTestId("W-JG-01.pool.amount").dataset.amountState).toBe("hollow");
    const draft = screen.getByTestId("W-JG-01.invoice.draft");
    expect(draft.dataset.provenance).toBe("claude");
    const figures = draft.querySelectorAll<HTMLElement>("[data-amount-state]");
    expect(figures).toHaveLength(3);
    for (const f of figures) expect(f.dataset.amountState).toBe("pencil");
    expect(within(screen.getByTestId("W-JG-01.photos")).getAllByRole("link")).toHaveLength(12);
    expect(screen.getByTestId("W-JG-01.rules.sealed").textContent).toMatch(
      /^sha256 [0-9a-f]{4} [0-9a-f]{4}, sealed/,
    );
    expect(root.querySelectorAll(".fs-slab").length).toBeLessThanOrEqual(2);
    expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("rest");
    expect(log.calls()).toEqual([]);
    await expectNoAxeViolations(view.container);
  });

  it("leads with the paper: at 1470 × 956 the desk lies beside the invoice, under the pool's strip", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470, height: 956 } });
    const funding = await screen.findByTestId("W-JG-01.funding");
    // The composition: the invoice on the left; the pool as one strip and the desk under it on the right, all
    // inside the one grid (never a row of its own after the money, which put the paper under the ribbon).
    expect(funding.dataset.layout).toBe("desk");
    expect(screen.getByTestId("W-JG-01.pool").dataset.variant).toBe("strip");
    const desk = screen.getByTestId("W-JG-01.desk");
    expect(desk.parentElement?.parentElement).toBe(funding);
    const order = [screen.getByTestId("W-JG-01.invoice"), screen.getByTestId("W-JG-01.pool"), desk];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]?.compareDocumentPosition(order[i] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    // Where the desk lands against the fold is a layout fact jsdom cannot measure (it lays nothing out): the
    // browser checks it. Hand-written pixel budgets here could not fail for a CSS change, so none is kept.
  });

  it("the first press starts the session and records the payment; MM-S plays on the invoice's event", async () => {
    const view = await renderConsole({ path: "/judge" });
    clearMomentTrace();
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    await waitFor(() => expect(momentPhase(view.container, "MM-S")).toBe("funded"), { timeout: 8000 });
    expect(tracedPhases("MM-S")).toEqual(["arc", "funded"]);
    expect(screen.getByTestId("W-JG-01").dataset.state).toBe("session");
    expect(screen.getByTestId("W-JG-01.invoice.amount").dataset.amountState).toBe("landed");
    expect(screen.getByTestId("W-JG-01.pool").dataset.state).toBe("landed");
    expect(screen.getByTestId("W-JG-01.funded").textContent).toBe("Funded");
    expect(screen.getByTestId("W-JG-01.funded.source").textContent).toMatch(
      /Simulated PayPal sandbox, status check/,
    );
    expect(screen.getByTestId("W-JG-01.status").textContent).toMatch(/^Funded\./);
    expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("committed");
    // The title follows the run: no longer "ready to pay" once the invoice has read back as paid.
    expect(screen.getByTestId("W-JG-01.title").textContent).toBe("Season 2026-A is funded.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Season 2026-A is funded.");
    await expectNoAxeViolations(view.container);
  });

  it("records the payment only once the session's run reads INVOICED (fs-api makes it in DRAFT, then invoices it)", async () => {
    const world = createTestWorld();
    const log = recordRequests();
    let polls = 0;
    let pollsBeforeMarkPaid: number | null = null;
    const handlers = [
      log.handler,
      // fs-api answers createJudgeSession with the run in DRAFT; Claude's invoice turn sends it afterwards.
      http.get("*/v1/judge/session", async ({ request }) => {
        polls += 1;
        const real = await getResponse([...world.mock.handlers], request);
        const body = (await real?.json()) as Record<string, unknown>;
        const runState = polls === 1 ? "DRAFT" : polls === 2 ? "QUOTED" : "INVOICED";
        return HttpResponse.json({ ...body, runState });
      }),
      http.post("*/v1/runs/:runSlug/mark-paid", () => {
        pollsBeforeMarkPaid ??= polls;
        return undefined;
      }),
    ];
    await renderConsole({ path: "/judge", world, handlers });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(world.run.state).toBe("FUNDED"));
    expect(pollsBeforeMarkPaid).toBe(3);
    expect(log.sent.filter((r) => r.path.endsWith("/mark-paid"))).toHaveLength(1);
    expect(screen.queryByTestId("W-JG-01.error")).toBeNull();
  });

  it("a resumed session already past INVOICED records nothing again: its stream replays where the run is", async () => {
    const world = createTestWorld();
    world.markPaid(); // the session funded in an earlier visit (the judge cookie resumes it)
    expect(world.run.state).toBe("IN_REVIEW");
    const log = recordRequests();
    await renderConsole({ path: "/judge", world, handlers: [log.handler] });
    await press("W-JG-01.markPaid");
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.title").textContent).toBe("Season 2026-A is funded."),
    );
    expect(log.sent.some((r) => r.path === "/v1/judge/session")).toBe(true);
    expect(log.sent.filter((r) => r.path.endsWith("/mark-paid"))).toEqual([]);
    expect(screen.queryByTestId("W-JG-01.error")).toBeNull();
  });

  it("reduced motion keeps every phase of MM-S", async () => {
    const view = await renderConsole({ path: "/judge", motion: "reduced" });
    clearMomentTrace();
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(momentPhase(view.container, "MM-S")).toBe("funded"), { timeout: 8000 });
    expect(tracedPhases("MM-S")).toEqual(["arc", "funded"]);
  });

  it("a refused payment reads in the console's words, and the slab rests again for another press", async () => {
    const world = createTestWorld();
    world.failNext("markPaid", "CIRCUIT_OPEN");
    await renderConsole({ path: "/judge", world });
    await press("W-JG-01.markPaid");
    const notice = await screen.findByTestId("W-JG-01.error");
    expect(notice.textContent).toMatch(/PayPal asked us to slow down/);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("rest"));
  });
});

describe("Play it for me", { timeout: 60_000 }, () => {
  afterEach(() => {
    autoplayTiming.stepMs = AUTOPLAY_STEP_MS;
  });

  it("presses the step the pill names with a visible cursor, and hands the stage back on Stop", async () => {
    autoplayTiming.stepMs = 40;
    const view = await renderConsole({ path: "/judge", motion: "reduced" });
    const toggle = screen.getByTestId("W-JG-01.autoplay");
    expect(toggle.textContent).toBe(AUTOPLAY_COPY.play);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("autoplay");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    expect(screen.getByTestId("W-JG-01.autoplay.cursor")).toBeTruthy();
    expect(screen.getByTestId("W-JG-01.autoplay").textContent).toBe(AUTOPLAY_COPY.stop);
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.autoplay"));
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("paused"));
  });

  it("stops before the first key: 'Your turn: hold to approve'", async () => {
    autoplayTiming.stepMs = 40;
    const view = await renderConsole({ path: "/judge", motion: "reduced" });
    await view.startSession();
    act(() => {
      view.world.markPaid();
      view.world.resolveAll();
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("approve"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.autoplay"));
    });
    await waitFor(
      () => expect(screen.getByTestId("W-JG-01.autoplay.tag").textContent).toBe(AUTOPLAY_COPY.approveTurn),
      {
        timeout: 4000,
      },
    );
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("paused");
    expect(view.router.state.location.pathname).toMatch(/\/approve$/);
    expect(view.world.approvals()).toHaveLength(0);
  });
});
