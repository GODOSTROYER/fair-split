// The phone visit under 1024 px (UI gate round 3): the bar keeps the product, the simulation status and its few
// controls; the laptop recommendation, "Copy the link" and Proof live in its overflow menu, so the member's
// statement follows the bar with nothing between them.

import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STAGE } from "../chrome/copy.js";
import { expectNoAxeViolations } from "../test/axe.js";
import { renderConsole } from "../test/render.js";

configure({ asyncUtilTimeout: 6000 });

describe("the phone visit", { timeout: 60_000 }, () => {
  it("keeps the bar to the product, the simulation status and its controls; the rest is in More", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 390, height: 844 } });
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("phone-visit");
    const bar = screen.getByTestId("W-JG-01.bar");
    expect(within(bar).getByText("Fair Split")).toBeTruthy();
    expect(screen.getByTestId("W-JG-01.notice").textContent).toContain("Simulated PayPal sandbox");
    // No Proof counter and no laptop line on the page itself.
    expect(screen.queryByTestId("W-JG-01.proofChip")).toBeNull();
    expect(screen.getByTestId("W-JG-01.visit").textContent).not.toContain(STAGE.phoneVisitLine);
    expect(screen.queryByTestId("W-JG-01.visit.copy")).toBeNull();
    // The overflow, at the end of the bar's controls.
    const more = within(bar).getByTestId("W-JG-01.visit.more");
    expect(more.getAttribute("aria-label")).toBe(STAGE.visitMore);
    await act(async () => {
      fireEvent.click(more);
    });
    const menu = await screen.findByTestId("W-JG-01.visit.menu");
    expect(menu.textContent).toContain(STAGE.phoneVisitLine);
    expect(menu.textContent).toContain(STAGE.phoneVisitPx);
    expect(within(menu).getByTestId("W-JG-01.visit.copy").textContent).toContain(STAGE.phoneVisitCopy);
    expect(within(menu).getByTestId("W-JG-01.visit.proof").getAttribute("href")).toMatch(/^\/proof\//);
    await expectNoAxeViolations(menu);
  });

  it("the desktop stage keeps its Proof counter and has no overflow menu", async () => {
    await renderConsole({ path: "/judge" });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.proofChip")).toBeTruthy());
    expect(screen.queryByTestId("W-JG-01.visit.more")).toBeNull();
  });
});
