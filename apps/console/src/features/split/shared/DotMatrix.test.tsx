import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DotMatrix, dotsOf, drawable } from "./DotMatrix.js";

describe("DotMatrix, the instrument numeral", () => {
  it("draws 5 × 7 dots a digit, one dot for the point, one empty column between glyphs", () => {
    const { dots, width, height } = dotsOf("2.05", 7);
    // 2, 0, 5 are 5 columns each; "." is 1: 16 columns, 3 gaps.
    expect(dots).toHaveLength((5 + 1 + 5 + 5) * 7);
    expect(width).toBe((5 + 1 + 1 + 1 + 5 + 1 + 5) * 7);
    expect(height).toBe(49);
    // The point lights only its bottom dot.
    expect(dots.filter((d) => d.key.startsWith("1-") && d.on)).toHaveLength(1);
  });

  it("is an image with its spoken value; units and money are never drawn in dots", () => {
    expect(drawable("US$4,333.50")).toBe("4333.50");
    const { getByRole } = render(<DotMatrix value="48/48" label="48 of 48 slips read" testId="dm" />);
    const svg = getByRole("img", { name: "48 of 48 slips read" });
    expect(svg.dataset.value).toBe("48/48");
    expect(svg.querySelectorAll("[data-on]").length).toBeGreaterThan(0);
    expect(svg.textContent).toBe("");
  });

  it("sweeps a change column by column inside each glyph, 24 ms apart", () => {
    const { container } = render(<DotMatrix value="1.62" label="1.62 percent" />);
    const delays = new Set(
      [...container.querySelectorAll<SVGCircleElement>("circle")].map((c) => c.style.transitionDelay),
    );
    expect([...delays].sort()).toEqual(["0ms", "24ms", "48ms", "72ms", "96ms"]);
  });
});
