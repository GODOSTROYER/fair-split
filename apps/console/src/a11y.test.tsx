// axe-core on every web route the shell registers (WCAG 2.2 AA tags; contrast is checked on the tokens and in
// Playwright, since jsdom has no layout). Slices keep this green as their screens replace the placeholders.

import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "./test/axe.js";
import { renderConsole } from "./test/render.js";

const RUN = "2026A-r37";

/** Boxes the CSS gives a max-height or an overflow (jsdom lays nothing out, so axe cannot see them scroll). */
const SCROLLERS = [".fsr-log__rows", ".pf-table-wrap", ".op-scroll"];
const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])";

describe("inner scrollers a keyboard can reach (axe scrollable-region-focusable)", () => {
  it.each([
    [webRoutes.fanout(RUN), "W-TR-08", 1470],
    [webRoutes.proof(RUN), "W-PF-01", 375],
    [webRoutes.ops(), "W-OP-01", 1470],
  ])("%s", async (path, testId, width) => {
    await renderConsole({ path, viewport: { width, height: 900 } });
    await screen.findByTestId(testId);
    // Proof's tables print under their plates: open every plate.
    for (const toggle of document.querySelectorAll<HTMLElement>("[data-testid$='.toggle']")) {
      await act(async () => {
        fireEvent.click(toggle);
      });
    }
    const boxes = SCROLLERS.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]);
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      // A scroller with something focusable inside is reached through it; one without must take focus itself.
      if (box.querySelector(FOCUSABLE)) continue;
      const region = box.closest<HTMLElement>("[data-scroll-region]");
      expect(region, `${box.className} is not in a focusable region`).not.toBeNull();
      expect(region?.tagName).toBe("SECTION");
      expect(region?.tabIndex).toBe(0);
      const labelledBy = region?.getAttribute("aria-labelledby");
      const name = labelledBy
        ? document.getElementById(labelledBy)?.textContent
        : region?.getAttribute("aria-label");
      expect(name?.trim()).toBeTruthy();
    }
  });
});

describe("accessibility of every route (axe)", () => {
  it.each([
    [webRoutes.judge(), "W-JG-01"],
    [webRoutes.season("2026-A"), "W-TR-01"],
    [webRoutes.rateCard("2026-A"), "W-TR-02"],
    [webRoutes.reading("2026-A", "B"), "W-TR-03"],
    [webRoutes.byHand("2026-A", "0462"), "W-TR-04"],
    [webRoutes.split(RUN), "W-TR-05"],
    [webRoutes.holdDrawer(RUN, "H1"), "W-TR-06"],
    [webRoutes.memberLine(RUN, "M-014"), "W-TR-09"],
    [webRoutes.approve(RUN), "W-TR-07"],
    [webRoutes.fanout(RUN), "W-TR-08"],
    [webRoutes.memberPrint(RUN, "M-053"), "W-TR-09"],
    [webRoutes.proof(RUN), "W-PF-01"],
    ["/b/brand-token-sample-0001", "W-BR-01"],
    [webRoutes.ops(), "W-OP-01"],
    [webRoutes.signIn(), "W-AU-01"],
    ["/nowhere", "not-found"],
  ])("%s", async (path, testId) => {
    const view = await renderConsole({ path });
    await screen.findByTestId(testId);
    await expectNoAxeViolations(view.container);
  });
});
