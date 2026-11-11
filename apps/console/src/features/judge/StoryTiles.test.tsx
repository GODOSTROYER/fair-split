// The first view's pipeline (ADR-0016; UI gate rounds 2 to 5, number first): every figure is counted from the seed or
// Proof's plates, the pay split is the plan until the run settles, nothing claims a live Claude reading, and each
// step's dot is its state only (round 5: pending, done, held, paid; never indigo).
import { UiProvider } from "@fairsplit/ui-web";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyRunEvents, firstView, sessionView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { StoryTiles, storyStates, storyTiles } from "./StoryTiles.js";

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

  it("light each step in its state's colour only: pending before the run, held while a person decides, paid in jade", () => {
    expect(Object.values(storyStates(firstView(snapshot)))).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    const world = createTestWorld();
    world.markPaid();
    const reading = applyRunEvents(sessionView(snapshot, world), world.eventsAfter(null));
    // Funded and read: slip 0462 waits for a person, and the holds are open.
    expect(storyStates(reading)).toMatchObject({
      read: "held",
      check: "held",
      sign: "pending",
      pay: "pending",
    });
    const settled = settledView();
    expect(storyStates(settled, { proofChecked: true })).toEqual({
      read: "done",
      check: "done",
      sign: "done",
      pay: "paid",
      prove: "done",
    });
    expect(storyStates(settled).prove).toBe("pending");
  });

  it("render as an ordered list of Read, Check, Sign, Pay and Prove, the plan said in a word", () => {
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
    // State dots only (round 5): every step a StateDot, none indigo, no square.
    expect(list.querySelectorAll(".fs-state-dot")).toHaveLength(5);
    for (const tile of tiles) expect(tile.dataset.state).toBe("pending");
  });

  it("never claims a live Claude reading", () => {
    for (const tile of storyTiles(snapshot)) expect(tile.text).not.toMatch(/Claude reads|Claude read\b/);
  });
});
