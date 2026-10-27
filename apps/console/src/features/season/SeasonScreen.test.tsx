// W-TR-01 season: the stencilled season and lot, the run strip lit in its true sequence, the invoice beside the
// pool, and BEAT-PAID (MM-S) when the invoice reads back as paid: the arc, the pool landing, "Funded" in jade.
// Offline says so. A season the seed does not hold is a plain refusal, not a broken screen.

import { act, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  momentPhase,
  renderConsole,
  tracedPhases,
} from "../../test/index.js";

// These render the whole console over the mock world and run axe on it: on a busy machine that is slow, so they
// wait longer than the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

const SEASON = "/season/2026-A";

describe("W-TR-01 season", { timeout: 60_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for Lantern Bay before the first press: the strip lights only 'Ratified', the money is hollow", async () => {
    const view = await renderConsole({ path: SEASON });
    const root = await screen.findByTestId("W-TR-01");
    expect(root.dataset.state).toBe("waiting");
    expect(screen.getByTestId("W-TR-01.state").textContent).toBe("Sent to Lantern Bay. Waiting for payment.");
    expect(screen.getByTestId("W-TR-01.mark").textContent).toMatch(/2026-A/);
    expect(screen.getByTestId("W-TR-01.strip.RATIFIED").dataset.state).toBe("lit");
    expect(screen.getByTestId("W-TR-01.strip.FUNDED").dataset.state).toBe("current");
    expect(screen.getByTestId("W-TR-01.strip.PAID").dataset.state).toBe("unlit");
    expect(screen.getByTestId("W-TR-01.invoice.amount").dataset.amountState).toBe("hollow");
    expect(screen.getByTestId("W-TR-01.pool.premium").dataset.amountState).toBe("hollow");
    expect(screen.getByTestId("W-TR-01.next").textContent).toMatch(/Mark the invoice paid \(sandbox\)/);
    expect(screen.getByTestId("W-TR-01.eval").dataset.state).toBe("empty");
    await expectNoAxeViolations(view.container);
  });

  it("BEAT-PAID: the GET reads paid, the arc draws, the pool lands and 'Funded' closes in jade", async () => {
    const view = await renderConsole({ path: SEASON });
    await screen.findByTestId("W-TR-01");
    await view.startSession();
    clearMomentTrace();
    act(() => {
      view.world.markPaid();
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-01").dataset.state).toBe("funded"));
    await waitFor(() => expect(momentPhase(view.container, "MM-S")).toBe("funded"), { timeout: 8000 });
    expect(tracedPhases("MM-S")).toEqual(["arc", "funded"]);
    expect(screen.getByTestId("W-TR-01.state").textContent).toBe("Marked as paid in sandbox.");
    expect(screen.getByTestId("W-TR-01.pool.premium").dataset.amountState).toBe("landed");
    expect(screen.getByTestId("W-TR-01.funded")).toBeTruthy();
    expect(screen.getByTestId("W-TR-01.strip.FUNDED").dataset.state).toBe("lit");
    expect(screen.getByTestId("W-TR-01.strip.READ").dataset.state).toBe("lit");
    await expectNoAxeViolations(view.container);
  });

  it("says so when the browser is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await renderConsole({ path: SEASON });
    const root = await screen.findByTestId("W-TR-01");
    expect(root.dataset.state).toBe("offline");
    expect(screen.getByTestId("W-TR-01.state").textContent).toMatch(/^You're offline\./);
  });

  it("refuses a season the seed does not hold, and links the one it does", async () => {
    await renderConsole({ path: "/season/2027-B" });
    const root = await screen.findByTestId("W-TR-01");
    expect(root.dataset.state).toBe("error");
    expect(root.textContent).toMatch(/No Season 2027-B here\./);
    expect(screen.getByRole("link", { name: "Open Season 2026-A" }).getAttribute("href")).toBe(SEASON);
  });
});
