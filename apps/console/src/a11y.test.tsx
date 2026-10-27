// axe-core on every web route the shell registers (WCAG 2.2 AA tags; contrast is checked on the tokens and in
// Playwright, since jsdom has no layout). Slices keep this green as their screens replace the placeholders.

import { webRoutes } from "@fairsplit/contracts";
import { screen } from "@testing-library/react";
import { describe, it } from "vitest";
import { expectNoAxeViolations } from "./test/axe.js";
import { renderConsole } from "./test/render.js";

const RUN = "2026A-r37";

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
