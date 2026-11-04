// The first view's five story tiles and the What's real strip (ADR-0016): every figure is counted from the seed or
// Proof's plates, and nothing claims a live Claude reading.
import { UiProvider } from "@fairsplit/ui-web";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seedSnapshot } from "../../test/world.js";
import { StoryTiles, storyTiles, WhatsRealStrip, whatsReal } from "./StoryTiles.js";

const snapshot = seedSnapshot();

describe("the story tiles", () => {
  it("count the season from the seed: 48 slips, 3 holds, 2 officers, 7 PayPal and 57 cash, 6 checks", () => {
    expect(storyTiles(snapshot).map((t) => t.text)).toEqual([
      "Claude is built to read 48 slips",
      "3 holds stop mistakes",
      "2 officers, 1 hash",
      "7 PayPal, 57 cash",
      "Brand re-checks 6",
    ]);
  });

  it("render as an ordered list of Read, Check, Sign, Pay and Prove, each in its role's colour", () => {
    render(
      <UiProvider lang="en" motion="full">
        <StoryTiles snapshot={snapshot} />
      </UiProvider>,
    );
    const list = screen.getByTestId("story-tiles");
    expect(list.tagName).toBe("OL");
    const tiles = within(list).getAllByRole("listitem");
    expect(tiles.map((t) => t.dataset.role)).toEqual(["read", "check", "sign", "pay", "prove"]);
    expect(tiles[3]?.textContent).toContain("4 Pay");
  });

  it("never claims a live Claude reading", () => {
    for (const tile of storyTiles(snapshot)) expect(tile.text).not.toMatch(/Claude reads|Claude read\b/);
  });
});

describe("What's real", () => {
  it("says what is real code, what is the simulated PayPal sandbox and what is synthetic", () => {
    expect(whatsReal(64).map((p) => p.title)).toEqual([
      "Real code, running now",
      "Simulated PayPal sandbox",
      "Synthetic samples",
    ]);
    render(
      <UiProvider lang="en" motion="full">
        <WhatsRealStrip members={64} />
      </UiProvider>,
    );
    const strip = screen.getByTestId("W-JG-01.realStrip");
    expect(strip.textContent).toContain("The co-op, its 64 people and their slips. No real money moves.");
    expect(strip.textContent).toContain("Proof's six checks");
  });
});
