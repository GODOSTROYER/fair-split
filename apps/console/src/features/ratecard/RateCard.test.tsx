// W-TR-02 the rate card: Schedule A printed from the ratified card, each rule pointing at its clause on the
// pages, and MM-4 Bolted: the bolted slab never travels, and only the server's 409 RATE_CARD_RATIFIED shakes it,
// clacks once and prints the refusal plate with the hash it cites (full and reduced). Its one live slab drafts
// a proposal for next season that is not in force. Axe on every state.

import { feedback } from "@fairsplit/ui-web";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

const RATE_CARD = "/season/2026-A/rate-card";

async function refuse(motion: "full" | "reduced") {
  const view = await renderConsole({ path: RATE_CARD, motion });
  await screen.findByTestId("W-TR-02");
  clearMomentTrace();
  await act(async () => {
    fireEvent.click(screen.getByTestId("W-TR-02.addOpen"));
  });
  const clacks = feedback.log.filter((l) => l.event === "bolted.refuse").length;
  await act(async () => {
    fireEvent.click(screen.getByTestId("W-TR-02.addCommit.face"));
  });
  await waitFor(() => expect(momentPhase(view.container, "MM-4")).toBe("done"), { timeout: 8000 });
  return { view, clacks };
}

describe("W-TR-02 rate card", { timeout: 60_000 }, () => {
  it("prints Schedule A from the ratified card, bolted under its hash; a rule points at its clause", async () => {
    const view = await renderConsole({ path: RATE_CARD });
    const root = await screen.findByTestId("W-TR-02");
    expect(root.dataset.state).toBe("ratified");
    const rules = within(screen.getByTestId("W-TR-02.rules")).getAllByRole("button");
    expect(rules).toHaveLength(8);
    expect(screen.getByTestId("W-TR-02.rule.R1").textContent).toMatch(
      /CBU: 5% of the bonus until ₱5,000 is paid up\./,
    );
    expect(screen.getByTestId("W-TR-02.bolted.sealed").textContent).toMatch(
      /^sha256 [0-9a-f]{4} [0-9a-f]{4}, sealed 14 Mar 2026 by BR 2026-04$/,
    );
    expect(screen.getByTestId("W-TR-02.pages").querySelectorAll("[data-band]")).toHaveLength(0);
    await act(async () => {
      fireEvent.mouseEnter(screen.getByTestId("W-TR-02.rule.R3"));
    });
    const banded = screen.getByTestId("W-TR-02.pages").querySelectorAll("[data-band]");
    expect(banded).toHaveLength(1);
    expect(banded[0]?.textContent).toMatch(/^R3 Loan repayment/);
    expect(screen.getByTestId("W-TR-02.footer").textContent).toBe(
      "Read by Claude (claude-opus-5-5). Quote found on page 2.",
    );
    await expectNoAxeViolations(view.container);
  });

  it("MM-4: the 409 citing the hash shakes the bolted slab, clacks once, and prints the refusal plate", async () => {
    const { view, clacks } = await refuse("full");
    expect(tracedPhases("MM-4")).toEqual(["refuse", "plate", "done"]);
    expect(feedback.log.filter((l) => l.event === "bolted.refuse").length).toBe(clacks + 1);
    expect(screen.getByTestId("W-TR-02").dataset.state).toBe("refused");
    expect(screen.getByTestId("W-TR-02.addCommit").dataset.state).toBe("bolted");
    const plate = screen.getByTestId("W-TR-02.refusal");
    expect(plate.textContent).toMatch(
      /Closed list\. BR 2026-04, Schedule A, allows only CBU, hauling, loans with an Authority to Deduct and advances with a voucher\. A new deduction needs a new Board resolution for Season 2026-B\. Rate card [0-9a-f]{4} [0-9a-f]{4}\./,
    );
    // The press started the judge's session: the API answered inside it, and nothing changed.
    expect(view.runtime.session.getState().status).toBe("active");
    expect(view.world.run.state).toBe("INVOICED");
    await expectNoAxeViolations(view.container);
  });

  it("reduced motion: no shake, the same phases, the plate fades in", async () => {
    await refuse("reduced");
    expect(tracedPhases("MM-4")).toEqual(["refuse", "plate", "done"]);
    expect(screen.getByTestId("W-TR-02.refusal").querySelector('[data-reveal="fade"]')).toBeTruthy();
  });

  it("the refusal's one live slab drafts a proposal for 2026-B, unhashed and not in force", async () => {
    const { view } = await refuse("full");
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-02.propose.face"), { key: "Enter" });
    });
    expect(screen.getByTestId("W-TR-02").dataset.state).toBe("proposal");
    const proposal = screen.getByTestId("W-TR-02.proposal");
    expect(proposal.textContent).toMatch(/Proposal for Season 2026-B/);
    expect(screen.getByTestId("W-TR-02.notInForce").textContent).toBe("Not in force");
    expect(proposal.textContent).toMatch(/Iba pa \(Other\)₱150/);
    expect(screen.getByTestId("W-TR-02.propose").dataset.state).toBe("unavailable");
    await expectNoAxeViolations(view.container);
  });
});
