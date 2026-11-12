// Every web route in the register (contracts webRoutes) is registered and renders its screen's root, with
// `data-testid="{screenId}"` and a `data-state`, against the mock world; malformed paths are a 404, never
// a half-rendered screen. The route tree is frozen with the shell, so this is the slices' safety net too.

import { webRoutes } from "@fairsplit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderConsole } from "./test/index.js";
import { WEB_ROUTE_CASES as CASES } from "./test/route-cases.js";

const RUN = "2026A-r37";

describe("web routes (register §4)", () => {
  it.each(CASES)("$path renders $screens", async ({ path, screens, stage }) => {
    const view = await renderConsole({ path });
    for (const id of screens) {
      const root = await screen.findByTestId(id);
      expect(root.dataset.state, `${id} has a data-state`).toBeTruthy();
      expect(root.dataset.screen ?? id).toBe(id);
    }
    if (stage) expect(screen.getByTestId("W-JG-01.stage")).toBeTruthy();
    else expect(screen.queryByTestId("W-JG-01.stage")).toBeNull();
    view.unmount();
  });

  it("/ opens the Judge stage", async () => {
    const view = await renderConsole({ path: "/" });
    await screen.findByTestId("W-JG-01");
    expect(view.router.state.location.pathname).toBe("/judge");
  });

  it("/runs/:runSlug alone opens its split review", async () => {
    const view = await renderConsole({ path: `/runs/${RUN}` });
    await screen.findByTestId("W-TR-05");
    expect(view.router.state.location.pathname).toBe(webRoutes.split(RUN));
  });

  it.each([
    "/nowhere",
    "/season/2026A",
    "/season/2026-A/by-hand/462",
    "/runs/r37/split",
    `/runs/${RUN}/members/14/print`,
    "/proof/not-a-run",
  ])("%s is a 404, not a half-rendered screen", async (path) => {
    await renderConsole({ path });
    expect(await screen.findByTestId("not-found")).toBeTruthy();
  });

  it("drops a search value that does not fit the register", async () => {
    const view = await renderConsole({
      path: `${webRoutes.split(RUN)}?hold=${encodeURIComponent("<script>")}&member=14`,
    });
    await screen.findByTestId("W-TR-05");
    expect(screen.queryByTestId("W-TR-06")).toBeNull();
    expect(screen.queryByTestId("W-TR-09")).toBeNull();
    expect(view.router.state.matches.at(-1)?.search).toMatchObject({ hold: undefined, member: undefined });
  });

  it("keeps WS-DS's /prototype working under the same root", async () => {
    await renderConsole({ path: webRoutes.prototype() });
    await waitFor(() => expect(document.querySelector("[data-testid^='W-DP-01']")).toBeTruthy());
  });

  it("Proof, print and the stage are all Adlaw, Hayag in v2 (ADR-0016: one light theme everywhere)", async () => {
    const proof = await renderConsole({ path: webRoutes.proof(RUN) });
    await screen.findByTestId("W-PF-01");
    expect(document.documentElement.dataset.theme).toBe("adlaw");
    proof.unmount();
    expect(document.documentElement.dataset.theme).toBe("adlaw");
    await renderConsole({ path: webRoutes.judge() });
    const stage = await screen.findByTestId("W-JG-01.stage");
    expect(document.documentElement.dataset.theme).toBe("adlaw");
    expect(within(stage).getByTestId("W-JG-01.rail")).toBeTruthy();
  });
});

it("offers a way back to the Fair Split console only on the judge session's Proof route", async () => {
  const view = await renderConsole({ path: webRoutes.proof(RUN) });
  await screen.findByTestId("W-PF-01");
  expect(screen.queryByRole("link", { name: "Fair Split console" })).toBeNull();
  await view.startSession();
  const back = await screen.findByRole("link", { name: "Fair Split console" });
  expect(back.getAttribute("href")).toBe(webRoutes.judge());
  // A line arrow leads it, hidden from a screen reader: the link's name is the product's name.
  expect(back.querySelector('[data-glyph="ms:arrow-back"]')?.getAttribute("aria-hidden")).toBe("true");
});
