// W-JG-01's first view and "Play it for me": the showcase snapshot with Claude's recorded draft in pencil and no
// calls; the first press starts the session and MM-S plays on the invoice's event (full and reduced); a refusal
// reads in the console's words; autoplay presses with a visible cursor and stops before the keys.

import { getSnapshot } from "@fairsplit/api-client/seed";
import { tagBudget } from "@fairsplit/ui-web";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunView } from "../../data/run-view.js";
import {
  clearMomentTrace,
  clickStageMenuItem,
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
  it("keeps the short invoice action whole, says where the run is, and names the season under it", async () => {
    await renderConsole({ path: "/judge" });
    const button = screen.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ });
    // The face's words; its Enter keycap is decoration, hidden from assistive tech.
    expect(button.querySelector(".fs-slab__words")?.textContent).toBe("Mark the invoice paid");
    // The lines' fold names itself and wears the seeded glyph (its words for a screen reader); its note stays
    // inside.
    const draft = screen.getByTestId("W-JG-01.invoice.draft");
    expect(draft.textContent).toContain("Invoice lines");
    expect(draft.textContent).toContain("Seeded sample");
    expect(draft.querySelector(".fs-legend-glyph")?.getAttribute("title")).toBe("Seeded sample");
    expect(draft.querySelector(".fs-honesty")).toBeNull();
    expect(draft.textContent).toContain("Claude did not draft these lines");
    // Round 3: the heading is a fact about the run, the past in grey and the present in ink.
    const heading = screen.getByRole("heading", { level: 1, name: "Invoice sent. Awaiting payment." });
    expect(heading.querySelector(".fsc-first__title-done")?.textContent).toBe("Invoice sent.");
    expect(heading.querySelector(".fsc-first__title-now")?.textContent).toBe("Awaiting payment.");
    // Nothing above the heading (no eyebrow): the season and the co-op are the meta line under it, with the facts.
    expect(heading.previousElementSibling).toBeNull();
    expect(heading.classList.contains("fs-t-title")).toBe(true);
    const meta = heading.nextElementSibling;
    expect(meta?.contains(screen.getByTestId("W-JG-01.mark"))).toBe(true);
    expect(meta?.contains(screen.getByTestId("W-JG-01.facts"))).toBe(true);
    expect(screen.getByTestId("W-JG-01.mark").textContent).toContain("Season 2026-A");
    // Ids and hashes in the one mono, words beside them in FS Sans.
    expect(screen.getByTestId("W-JG-01.rules.sealed").querySelector(".fs-t-id")?.textContent).toMatch(
      /^[0-9a-f]{4} [0-9a-f]{4}$/,
    );
    expect(screen.getByTestId("W-JG-01.invoice.id").querySelector(".fs-t-id")?.textContent).toBe(
      getSnapshot().run.invoice.invoiceNumber,
    );
  });

  it("keeps the recording pill until the payment command answers", async () => {
    let entered = false;
    let finish: (() => void) | undefined;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await renderConsole({
      path: "/judge",
      handlers: [
        http.post("*/v1/runs/:slug/mark-paid", async () => {
          entered = true;
          await response;
          return undefined;
        }),
      ],
    });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(entered).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("recording");
    finish?.();
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("reading"));
  });

  it("a settled run names its actual rail counts and keeps the paid press as a record", async () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    world.payCash("M-031");
    const view = await renderConsole({ path: "/judge", world });
    await view.startSession();
    // Round 3: never "settled" or "done" while the bodega's cash is due; the pay split is what happened.
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.title").textContent).toBe("7 paid by PayPal. 57 due in cash."),
    );
    expect(screen.getByTestId("W-JG-01.title").textContent).not.toMatch(/settled|done/i);
    expect(screen.getByTestId("W-JG-01.markPaid").textContent).toMatch(/Marked paid by Analyn/);
    const status = screen.getByTestId("W-JG-01.status");
    expect(status.textContent).toMatch(/^PayPal complete · cash due/);
    expect(screen.getByTestId("W-JG-01.continue").textContent).toBe("Review cash handover");
    expect(screen.getByTestId("story-tiles.pay").textContent).toContain("7 PayPal · 57 cash");
    expect(screen.getByTestId("story-tiles.pay").dataset.phase).toBe("settled");
  });

  it("inv.i8.a settled run whose payouts replayed names the replay, never PayPal payments", async () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    world.payCash("M-031");
    const view = await renderConsole({ path: "/judge", world });
    await view.startSession();
    await waitFor(() => expect(screen.getByTestId("W-JG-01.title").textContent).toMatch(/by PayPal/));
    const key = ["run", getSnapshot().run.runSlug];
    const live = view.runtime.client.getQueryData<RunView>(key);
    if (!live) throw new Error("the settled run must be cached");
    const items = Object.entries(live.items).map(([id, item]) => [id, { ...item, provenance: "replay" }]);
    act(() => view.runtime.client.setQueryData(key, { ...live, items: Object.fromEntries(items) }));
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.title").textContent).toBe("7 payouts replayed. 57 due in cash."),
    );
    expect(screen.getByTestId("W-JG-01.title").textContent).not.toMatch(/PayPal/);
    expect(screen.getByTestId("W-JG-01.status").textContent).toMatch(/^Payouts replayed/);
  });

  it("shows the showcase with no calls: the desk, the bolted card, Claude's draft in pencil, the invoice hollow", async () => {
    // The log is installed before the first render, so it sees anything the page sends while mounting.
    const log = recordRequests();
    const view = await renderConsole({ path: "/judge", handlers: [log.handler] });
    const root = await screen.findByTestId("W-JG-01");
    expect(root.dataset.state).toBe("ready");
    expect(within(root).getByRole("heading", { level: 1 }).textContent).toBe(
      "Invoice sent. Awaiting payment.",
    );
    expect(screen.getByTestId("W-JG-01.invoice.amount").dataset.amountState).toBe("hollow");
    expect(screen.getByTestId("W-JG-01.pool.amount").dataset.amountState).toBe("hollow");
    // The invoice id before the press is the showcase run's, and says so (round 3: one id, said for what it is).
    expect(screen.getByTestId("W-JG-01.invoice.id").textContent).toBe(
      `${getSnapshot().run.invoice.invoiceNumber} · showcase run`,
    );
    // The pool as one line, true to the cent: the invoice, minus the payout costs, is the pool. Pending until the
    // simulated PayPal funds it: grey, and no tag yet. Round 4: the hollow dot and its word sit in the card's head
    // ("Pool · 64 members", "Not funded"), never inside the sum, where it read as the letter o.
    const eq = screen.getByTestId("W-JG-01.pool.eq");
    expect(eq.dataset.state).toBe("pending");
    expect(eq.textContent).toContain("Invoice US$4,333.50 minus costs US$60.00 equals the pool");
    expect(eq.querySelector(".fs-state-dot")).toBeNull();
    const poolState = screen.getByTestId("W-JG-01.pool.state");
    expect(poolState.textContent).toBe("Not funded");
    expect(poolState.querySelector('.fs-state-dot[data-kind="pending"]')).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Pool\W+64 members$/ })).toBeTruthy();
    expect(screen.getByTestId("W-JG-01.pool.disbursement").textContent).toBe("US$60.00");
    expect(screen.queryByTestId("W-JG-01.pool.tag")).toBeNull();
    const draft = screen.getByTestId("W-JG-01.invoice.draft");
    expect(draft.dataset.provenance).toBe("seeded");
    const figures = draft.querySelectorAll<HTMLElement>("[data-amount-state]");
    expect(figures).toHaveLength(3);
    for (const f of figures) expect(f.dataset.amountState).toBe("pencil");
    expect(within(screen.getByTestId("W-JG-01.photos")).getAllByRole("link")).toHaveLength(12);
    expect(screen.getByTestId("W-JG-01.rules.sealed").textContent).toMatch(
      /^[0-9a-f]{4} [0-9a-f]{4} · sealed \d{1,2} [A-Z][a-z]{2}$/,
    );
    // One line of facts under the title; the slips' counts on the desk say their scope (round 3).
    expect(screen.getByTestId("W-JG-01.facts").textContent).toBe("64 members · 1 invoice");
    expect(screen.getByTestId("W-JG-01.slips").textContent).toBe("12 photos · 48 this run · 264 season");
    // The PayPal money value wears the one micro-tag; a screen reader hears the whole label. No legend row, and
    // the stage stays inside the tag budget (the top bar's indicator included).
    const tag = screen.getByTestId("W-JG-01.invoice.tag");
    expect(tag.dataset.fsTag).toBe("micro");
    expect(tag.textContent).toContain("Simulated PayPal sandbox");
    expect(screen.queryByTestId("W-JG-01.realStrip")).toBeNull();
    expect(screen.getByTestId("W-JG-01.synthetic").querySelector("[data-fs-glyph]")).toBeTruthy();
    const budget = tagBudget(screen.getByTestId("W-JG-01.stage"));
    expect(budget).toMatchObject({ ok: true });
    expect(budget.tags).toBeLessThanOrEqual(3);
    expect(screen.getByTestId("story-tiles.pay").textContent).toContain("8 PayPal · 56 cash planned");
    expect(root.querySelectorAll(".fs-slab").length).toBeLessThanOrEqual(2);
    expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("rest");
    expect(log.calls()).toEqual([]);
    await expectNoAxeViolations(view.container);
  });

  it("the desk's exhibit link opens the reading room and focuses the exhibit once its screen has drawn it", async () => {
    await renderConsole({ path: "/judge" });
    const link = within(screen.getByTestId("W-JG-01.desk")).getByRole("link", {
      name: /Claude's real readings of 10 hero slips/,
    });
    // The reading room can commit after navigate() resolves (a lazy chunk, a transition): for a moment after the
    // route changes, its exhibit heading is not in the document yet.
    const lookup = document.getElementById.bind(document);
    let drawn = false;
    let lookups = 0;
    const late = vi.spyOn(document, "getElementById").mockImplementation((id: string) => {
      if (id !== "fsc-heroes-title") return lookup(id);
      lookups += 1;
      return drawn ? lookup(id) : null;
    });
    try {
      link.focus();
      await act(async () => {
        fireEvent.click(link);
      });
      await screen.findByTestId("W-TR-03");
      // The link has looked for the heading before the route changed and again after it: only now is it drawn.
      await waitFor(() => expect(lookups).toBeGreaterThanOrEqual(2));
      drawn = true;
      await waitFor(() => expect(document.activeElement?.id).toBe("fsc-heroes-title"));
    } finally {
      late.mockRestore();
    }
  });

  it("leads with the paper: at 1470 × 956 the desk lies beside the invoice, under the pool's strip", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470, height: 956 } });
    const funding = await screen.findByTestId("W-JG-01.funding");
    // Round 4: the first view sits on the one twelve-column grid, and the desk is two top-aligned stacks on it: the
    // money (the invoice, then the rate card under it) and the paper (the pool's strip, then the slips under it).
    expect(screen.getByTestId("W-JG-01").classList.contains("fsc-screen")).toBe(true);
    expect(funding.dataset.layout).toBe("desk");
    expect(screen.getByTestId("W-JG-01.pool").dataset.variant).toBe("strip");
    const desk = screen.getByTestId("W-JG-01.desk");
    const money = screen.getByTestId("W-JG-01.invoice").parentElement;
    const paper = screen.getByTestId("W-JG-01.pool").parentElement;
    expect(money?.dataset.col).toBe("money");
    expect(paper?.dataset.col).toBe("paper");
    expect(money?.parentElement).toBe(funding);
    expect(paper?.parentElement).toBe(funding);
    expect(screen.getByTestId("W-JG-01.rules").parentElement).toBe(money);
    expect(desk.parentElement?.parentElement).toBe(paper);
    const order = [
      screen.getByTestId("W-JG-01.invoice"),
      screen.getByTestId("W-JG-01.rules"),
      screen.getByTestId("W-JG-01.pool"),
      desk,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]?.compareDocumentPosition(order[i] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    // The title row keeps the heading and its one meta line only; the five steps follow the desk.
    expect(within(screen.getByTestId("W-JG-01")).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByTestId("W-JG-01").querySelector(".fsc-first__head [data-testid='W-JG-01.rules']"),
    ).toBeNull();
    expect(funding.compareDocumentPosition(screen.getByTestId("story-tiles"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    expect(screen.getByTestId("W-JG-01.funded.source").textContent).toMatch(/^status check · \d{2}:\d{2}/);
    expect(screen.getByTestId("W-JG-01.funded.source").getAttribute("title")).toMatch(
      /Simulated PayPal sandbox, status check/,
    );
    // Funded, the pool is ink and wears the second micro-tag: still three tags on the stage at most.
    expect(screen.getByTestId("W-JG-01.pool.eq").dataset.state).toBe("landed");
    expect(screen.getByTestId("W-JG-01.pool.tag").dataset.fsTag).toBe("micro");
    expect(tagBudget(screen.getByTestId("W-JG-01.stage")).ok).toBe(true);
    expect(screen.getByTestId("W-JG-01.status").textContent).toMatch(/^Funded(?!\.)/);
    expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("committed");
    // The title follows the run: the invoice read back as paid (the simulated record-payment marks it), the pool
    // is funded.
    expect(screen.getByTestId("W-JG-01.title").textContent).toMatch(
      /^Invoice (marked )?paid\. Pool funded\.$/,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Pool funded\.$/);
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
    await waitFor(() => expect(screen.getByTestId("W-JG-01.title").textContent).toMatch(/Pool funded\.$/));
    expect(log.sent.some((r) => r.path === "/v1/judge/session")).toBe(true);
    expect(log.sent.filter((r) => r.path.endsWith("/mark-paid"))).toEqual([]);
    expect(screen.queryByTestId("W-JG-01.error")).toBeNull();
  });

  it("a resumed session whose run ended unfunded (cancelled) ends the press: never busy, and the slab rests", async () => {
    const world = createTestWorld();
    const log = recordRequests();
    const handlers = [
      log.handler,
      // The invoice auto-cancelled in an earlier visit: the session's run reads CANCELLED, and never funds.
      http.get("*/v1/judge/session", async ({ request }) => {
        const real = await getResponse([...world.mock.handlers], request);
        const body = (await real?.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...body, runState: "CANCELLED" });
      }),
    ];
    await renderConsole({ path: "/judge", world, handlers });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(log.sent.some((r) => r.path === "/v1/judge/session")).toBe(true));
    const action = screen.getByTestId("W-JG-01.action");
    await waitFor(() => expect(action.getAttribute("aria-busy")).toBeNull());
    expect(action.dataset.state).toBe("idle");
    expect(log.sent.filter((r) => r.path.endsWith("/mark-paid"))).toEqual([]);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("rest"));
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
    expect(notice.textContent).toMatch(/The simulated PayPal rate limit paused calls/);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("rest"));
  });
});

describe("Play it for me", { timeout: 60_000 }, () => {
  const busyMs = autoplayTiming.busyMs;
  afterEach(() => {
    autoplayTiming.stepMs = AUTOPLAY_STEP_MS;
    autoplayTiming.busyMs = busyMs;
  });

  it("waits while its press is in flight (the session's invoice is still being sent): never 'stuck', one payment", async () => {
    autoplayTiming.stepMs = 40;
    const world = createTestWorld();
    const log = recordRequests();
    let polls = 0;
    const draftFor = 12; // well past autoplay's four idle ticks
    const handlers = [
      log.handler,
      http.get("*/v1/judge/session", async ({ request }) => {
        polls += 1;
        const real = await getResponse([...world.mock.handlers], request);
        const body = (await real?.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...body, runState: polls <= draftFor ? "DRAFT" : body.runState });
      }),
    ];
    const view = await renderConsole({ path: "/judge", motion: "reduced", world, handlers });
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.autoplay"));
    });
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"), { timeout: 20_000 });
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).not.toBe("paused");
    expect(log.sent.filter((r) => r.path.endsWith("/mark-paid"))).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.autoplay"));
    });
  });

  it("a press that never lands (its run's stream went quiet) says 'stuck' after a ceiling, never waits forever", async () => {
    autoplayTiming.stepMs = 40;
    autoplayTiming.busyMs = 600;
    const world = createTestWorld();
    const log = recordRequests();
    const handlers = [
      log.handler,
      // The stream opens and never speaks: the payment is recorded, but the stage never reads it back as funded.
      http.get(
        "*/v1/runs/:runSlug/events",
        () =>
          new HttpResponse(new ReadableStream(), {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
          }),
      ),
    ];
    await renderConsole({ path: "/judge", motion: "reduced", world, handlers });
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.autoplay"));
    });
    await waitFor(() => expect(world.run.state).toBe("FUNDED"));
    expect(screen.getByTestId("W-JG-01.action").getAttribute("aria-busy")).toBe("true");
    await waitFor(
      () => expect(screen.getByTestId("W-JG-01.autoplay.tag").textContent).toBe(AUTOPLAY_COPY.stuck),
      {
        timeout: 5000,
      },
    );
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("paused");
    expect(log.sent.filter((r) => r.path.endsWith("/mark-paid"))).toHaveLength(1);
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

describe("server payment pacing", () => {
  it("a 409 rereads the session and accepts an already funded run without an error banner", async () => {
    const world = createTestWorld();
    await renderConsole({
      path: "/judge",
      world,
      handlers: [
        http.post("*/v1/runs/:slug/mark-paid", () => {
          world.markPaid();
          return HttpResponse.json(
            { code: "VERSION_CONFLICT", status: 409, message: "Already funded" },
            { status: 409 },
          );
        }),
      ],
    });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.title").textContent).toContain("Pool funded"));
    expect(screen.queryByTestId("W-JG-01.error")).toBeNull();
  });
  it("shows a QUEUED delay, then retries exactly once", async () => {
    let calls = 0;
    await renderConsole({
      path: "/judge",
      handlers: [
        http.post("*/v1/runs/:slug/mark-paid", () => {
          calls++;
          return calls === 1
            ? HttpResponse.json(
                { code: "QUEUED", status: 429, message: "Paced", retryAfterMs: 700 },
                { status: 429 },
              )
            : undefined;
        }),
      ],
    });
    await press("W-JG-01.markPaid");
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.status").textContent).toContain("You're next, about 1 s"),
    );
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.queryByTestId("W-JG-01.error")).toBeNull();
  });
  it("Reset removes the queue caption and cancels its deferred payment press", async () => {
    let calls = 0;
    await renderConsole({
      path: "/judge",
      handlers: [
        http.post("*/v1/runs/:slug/mark-paid", () => {
          calls++;
          return HttpResponse.json(
            { code: "QUEUED", status: 429, message: "Paced", retryAfterMs: 700 },
            { status: 429 },
          );
        }),
      ],
    });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.status").textContent).toContain("You're next"));
    // Round 4: Reset is in the chevron's menu.
    await clickStageMenuItem("W-JG-01.reset");
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.title").textContent).toContain("Awaiting payment"),
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(calls).toBe(1);
    expect(screen.queryByText(/You're next/)).toBeNull();
  });
});
