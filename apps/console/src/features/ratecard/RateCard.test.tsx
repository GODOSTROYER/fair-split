// W-TR-02 the rate card: Schedule A printed from the ratified card, each rule pointing at its clause on the
// pages, and MM-4 Bolted: the bolted slab never travels, and only the server's 409 RATE_CARD_RATIFIED shakes it,
// clacks once and prints the refusal plate with the hash it cites (full and reduced). Its one live slab drafts
// a proposal for next season that is not in force. Axe on every state.

import { feedback } from "@fairsplit/ui-web";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  clearMomentTrace,
  createTestWorld,
  expectNoAxeViolations,
  momentPhase,
  renderConsole,
  type TestWorld,
  tracedPhases,
} from "../../test/index.js";

// These render the whole console over the mock world and run axe on it: on a busy machine that is slow, so they
// wait longer than the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

const RATE_CARD = "/season/2026-A/rate-card";

async function refuse(motion: "full" | "reduced", world?: TestWorld) {
  const view = await renderConsole({ path: RATE_CARD, motion, ...(world ? { world } : {}) });
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
    // The stand-in is a bare legend glyph (round 3): its words whole as its title and accessible name, the page
    // the pointed rule was quoted from as micro beside it.
    const footer = screen.getByTestId("W-TR-02.footer");
    expect(footer.querySelector("[data-fs-glyph]")?.getAttribute("title")).toBe(
      "Seed stand-in, not a Claude recording. Seeded quote on page 2.",
    );
    expect(footer.textContent).toBe("Seed stand-in, not a Claude recording. Seeded quote on page 2.p. 2");
    expect(screen.getByTestId("W-TR-02").textContent).not.toMatch(/[Bb]olted/);
    await expectNoAxeViolations(view.container);
  });

  it("MM-4: the 409 citing the hash shakes the bolted slab, clacks once, and prints the refusal plate", async () => {
    const scrolling = vi.spyOn(Element.prototype, "scrollIntoView");
    const { view, clacks } = await refuse("full");
    expect(tracedPhases("MM-4")).toEqual(["refuse", "plate", "done"]);
    expect(feedback.log.filter((l) => l.event === "bolted.refuse").length).toBe(clacks + 1);
    expect(screen.getByTestId("W-TR-02").dataset.state).toBe("refused");
    expect(screen.getByTestId("W-TR-02.addCommit").dataset.state).toBe("bolted");
    const plate = screen.getByTestId("W-TR-02.refusal");
    const heading = within(plate).getByRole("heading");
    expect(document.activeElement).toBe(heading);
    // The refusal is its title (round 3); its reason waits behind "Why" and never repeats the rule list.
    expect(heading.textContent).toBe("Refused · Schedule A is closed until 2026-B");
    expect(scrolling).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" }));
    expect(screen.getByTestId("announcer").textContent).toBe(heading.textContent);
    expect(
      screen.getByTestId("W-TR-02.addCommit").compareDocumentPosition(plate) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const why = screen.getByTestId("W-TR-02.why");
    expect(why.tagName).toBe("DETAILS");
    expect(why.hasAttribute("open")).toBe(false);
    expect(within(why).getByText("Why").tagName).toBe("SUMMARY");
    expect(plate.textContent).toMatch(
      /BR 2026-04 locked Schedule A for 2026-A\. A new deduction needs a 2026-B resolution\. Rate card [0-9a-f]{4} [0-9a-f]{4}\./,
    );
    expect(plate.textContent).not.toMatch(/allows only|CBU|hauling|[Bb]olted/);
    expect(screen.getByTestId("W-TR-02.add").textContent).toMatch(/Locked by BR 2026-04/);
    // The hash it cites prints once, in its own caption.
    expect(plate.textContent?.match(/Rate card [0-9a-f]{4} [0-9a-f]{4}\./g)).toHaveLength(1);
    expect(plate.querySelector(".fsc-rc__refusal-text .fs-t-caption")?.textContent).toMatch(
      /^Rate card [0-9a-f]{4} [0-9a-f]{4}\.$/,
    );
    // The press started the judge's session: the API answered inside it, and nothing changed.
    expect(view.runtime.session.getState().status).toBe("active");
    expect(view.world.run.state).toBe("INVOICED");
    await expectNoAxeViolations(view.container);
  });

  it("MM-4 posts to the session workspace's own card: a judge workspace's clone mints its own rate card ID", async () => {
    // fs-api looks the card up in the workspace first (404 for the seed's ID), before the ratified-card trigger.
    const world = createTestWorld({ rateCardId: "019ceb5b-fc00-7d12-90d6-00000000c10e" });
    await refuse("full", world);
    expect(screen.getByTestId("W-TR-02").dataset.state).toBe("refused");
    expect(screen.queryByTestId("W-TR-02.error")).toBeNull();
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
