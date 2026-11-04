// The first view's five steps and the honesty row (ADR-0016; UI gate round 2, number first): every figure is
// counted from the seed or Proof's plates, and nothing claims a live Claude reading.
import { UiProvider } from "@fairsplit/ui-web";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seedSnapshot } from "../../test/world.js";
import { StoryTiles, storyTiles, WhatsRealStrip, whatsReal } from "./StoryTiles.js";

const snapshot = seedSnapshot();

describe("the story tiles", () => {
  it("count the season from the seed: 48 slips, 3 holds, 2 keys, 7 PayPal and 57 cash, 6 checks", () => {
    expect(storyTiles(snapshot).map((t) => t.text)).toEqual([
      "48 slips",
      "3 holds",
      "2 keys",
      "7 PayPal · 57 cash",
      "6 checks",
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
    expect(tiles[3]?.textContent).toContain("Pay");
    expect(tiles[3]?.textContent).toContain("7 PayPal · 57 cash");
  });

  it("never claims a live Claude reading", () => {
    for (const tile of storyTiles(snapshot)) expect(tile.text).not.toMatch(/Claude reads|Claude read\b/);
  });
});

describe("the honesty row", () => {
  it("is the legend of three marks: real code, the simulated PayPal sandbox, a synthetic sample", () => {
    expect(whatsReal().map((p) => p.title)).toEqual([
      "Real code",
      "Simulated PayPal sandbox",
      "Synthetic sample",
    ]);
    expect(whatsReal("sandbox")[1]?.title).toBe("PayPal sandbox, untested in this build");
    render(
      <UiProvider lang="en" motion="full">
        <WhatsRealStrip />
      </UiProvider>,
    );
    const strip = screen.getByTestId("W-JG-01.realStrip");
    expect(strip.textContent).toBe("Real codeSimulated PayPal sandboxSynthetic sample");
  });
});
