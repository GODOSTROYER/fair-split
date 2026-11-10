// The first view's five steps (ADR-0016; UI gate rounds 2 and 3, number first): every figure is counted from the
// seed or Proof's plates, the pay split is the plan until the run settles, and nothing claims a live Claude reading.
import { UiProvider } from "@fairsplit/ui-web";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyRunEvents, firstView, sessionView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { StoryTiles, storyTiles } from "./StoryTiles.js";

const snapshot = seedSnapshot();

function settledView() {
  const world = createTestWorld();
  world.markPaid();
  world.enterByHand("64.80");
  world.resolveAll();
  world.sign("treasurer");
  world.cosign();
  world.payCash("M-031");
  return applyRunEvents(sessionView(snapshot, world), world.eventsAfter(null));
}

describe("the story tiles", () => {
  it("count the season from the seed: 48 slips, 3 holds, 2 keys, the planned 8 PayPal and 56 cash, 6 checks", () => {
    expect(storyTiles(snapshot, firstView(snapshot)).map((t) => t.text)).toEqual([
      "48 slips",
      "3 holds",
      "2 keys",
      "8 PayPal · 56 cash planned",
      "6 checks",
    ]);
  });

  it("say what happened once the run settles: 7 PayPal and 57 cash (Rhea's line moved to cash)", () => {
    const pay = storyTiles(snapshot, settledView()).find((t) => t.role === "pay");
    expect(pay).toMatchObject({ text: "7 PayPal · 57 cash", phase: "settled" });
  });

  it("render as an ordered list of Read, Check, Sign, Pay and Prove, the plan in grey", () => {
    render(
      <UiProvider lang="en" motion="full">
        <StoryTiles snapshot={snapshot} view={firstView(snapshot)} />
      </UiProvider>,
    );
    const list = screen.getByTestId("story-tiles");
    expect(list.tagName).toBe("OL");
    const tiles = within(list).getAllByRole("listitem");
    expect(tiles.map((t) => t.dataset.role)).toEqual(["read", "check", "sign", "pay", "prove"]);
    expect(tiles[3]?.textContent).toContain("Pay");
    expect(tiles[3]?.textContent).toContain("8 PayPal · 56 cash planned");
    expect(tiles[3]?.dataset.phase).toBe("planned");
  });

  it("never claims a live Claude reading", () => {
    for (const tile of storyTiles(snapshot)) expect(tile.text).not.toMatch(/Claude reads|Claude read\b/);
  });
});
