// UI gate round 3: honesty marks with a budget, the shared instrument numeral, state dots and the money role.

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  DOT_MATRIX_UNLIT,
  DotMatrix,
  dotsOf,
  drawable,
  HONESTY,
  HonestyLegend,
  HonestyTag,
  LegendGlyph,
  MicroTag,
  MoneyFigure,
  Paper,
  StateDot,
  TAG_BUDGET,
  tagBudget,
  UiProvider,
} from "../src/index.js";

const wrap = (node: ReactNode) => (
  <UiProvider lang="en" motion="full">
    {node}
  </UiProvider>
);

describe("honesty marks (round 3)", () => {
  it("the micro-tag shows 'Sandbox' and says the whole label to a screen reader and in its tooltip", () => {
    render(wrap(<MicroTag testId="mt" />));
    const tag = screen.getByTestId("mt");
    expect(tag.dataset.fsTag).toBe("micro");
    expect(tag.getAttribute("title")).toBe("Simulated PayPal sandbox");
    const word = tag.querySelector(".fs-microtag__word");
    expect(word?.textContent).toBe("Sandbox");
    expect(word?.getAttribute("aria-hidden")).toBe("true");
    expect(tag.querySelector(".fs-sr")?.textContent).toBe("Simulated PayPal sandbox");
    const circle = tag.querySelector("svg circle");
    expect(tag.querySelector("svg")?.getAttribute("width")).toBe("12");
    expect(circle?.getAttribute("stroke-dasharray")).toMatch(/\d/);
  });

  it("a legend glyph is bare: no words on screen, its label as tooltip and accessible text", () => {
    render(wrap(<LegendGlyph {...HONESTY.seedStandIn} testId="g" />));
    const glyph = screen.getByTestId("g");
    expect(glyph.dataset.kind).toBe("synthetic");
    expect(glyph.getAttribute("title")).toBe("Seed stand-in, not a Claude recording");
    expect(glyph.querySelector(".fs-sr")?.textContent).toBe("Seed stand-in, not a Claude recording");
    expect(glyph.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.dataset.fsTag).toBeUndefined();
  });

  it("draws three shapes: a solid square (real), a dashed circle (simulated), a hatched square (synthetic)", () => {
    render(
      wrap(
        <>
          <LegendGlyph kind="real" label="Real code" testId="real" />
          <LegendGlyph kind="simulated" label="Simulated PayPal sandbox" testId="sim" />
          <LegendGlyph kind="synthetic" label="Synthetic sample" testId="syn" />
        </>,
      ),
    );
    expect(screen.getByTestId("real").querySelector("rect")?.getAttribute("fill")).toBe("currentColor");
    expect(screen.getByTestId("sim").querySelector("circle")?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(screen.getByTestId("syn").querySelectorAll("line").length).toBeGreaterThan(2);
    // No ids: two glyphs on a page never share one.
    expect(document.querySelectorAll("[id]").length).toBe(0);
  });

  it("maps every provenance pill the stage used to a glyph kind, keeping the pinned seed phrase", () => {
    expect(HONESTY.seedStandIn.label).toBe("Seed stand-in, not a Claude recording");
    expect(HONESTY.simulatedSandbox).toEqual({ kind: "simulated", label: "Simulated PayPal sandbox" });
    expect(HONESTY.demoKey.kind).toBe("simulated");
    for (const name of ["seededSample", "syntheticSample", "demoData"] as const)
      expect(HONESTY[name].kind).toBe("synthetic");
  });

  it("the legend has the three rows, glyph and term", () => {
    render(wrap(<HonestyLegend testId="legend" lines={{ real: "Engine, holds, signatures" }} />));
    const rows = screen.getByTestId("legend").querySelectorAll(".fs-legend__row");
    expect([...rows].map((r) => r.textContent)).toEqual([
      "Real codeEngine, holds, signatures",
      "Simulated",
      "Synthetic",
    ]);
  });

  it("budgets three tags a screen, the bar's quiet indicator included, and two micro-tags", () => {
    expect(TAG_BUDGET).toEqual({ perScreen: 3, microPerScreen: 2 });
    const { container, rerender } = render(
      wrap(
        <>
          <HonestyTag quiet>Simulated PayPal sandbox</HonestyTag>
          <MicroTag />
          <MicroTag />
          <LegendGlyph {...HONESTY.syntheticSample} />
        </>,
      ),
    );
    expect(tagBudget(container)).toEqual({ tags: 3, micro: 2, glyphs: 1, ok: true });
    rerender(
      wrap(
        <>
          <HonestyTag quiet>Simulated PayPal sandbox</HonestyTag>
          <MicroTag />
          <MicroTag />
          <MicroTag />
        </>,
      ),
    );
    expect(tagBudget(container).ok).toBe(false);
  });

  it("the quiet bar indicator keeps its words and marks itself as the bar's", () => {
    render(
      wrap(
        <HonestyTag quiet testId="bar">
          Simulated PayPal sandbox
        </HonestyTag>,
      ),
    );
    const tag = screen.getByTestId("bar");
    expect(tag.textContent).toBe("Simulated PayPal sandbox");
    expect(tag.dataset.fsTag).toBe("bar");
    expect(tag.dataset.quiet).toBe("");
  });

  it("paper wears the synthetic glyph, not a sticker; its name still says Synthetic sample", () => {
    render(
      wrap(
        <Paper alt="Slip 0462" testId="paper">
          <span>slip</span>
        </Paper>,
      ),
    );
    const tag = screen.getByTestId("paper").querySelector("figcaption");
    expect(tag?.querySelector(".fs-legend-glyph")?.getAttribute("data-kind")).toBe("synthetic");
    expect(tag?.textContent).toBe("Synthetic sample");
    expect(screen.getByRole("img", { name: /Slip 0462\. Synthetic sample/ })).toBeTruthy();
  });
});

describe("state dots and money (round 3)", () => {
  it("pending is a hollow dot, a waiting signer a hollow circle, signed a solid green dot", () => {
    render(
      wrap(
        <>
          <StateDot kind="pending" testId="p" />
          <StateDot kind="waiting" testId="w" />
          <StateDot kind="done" testId="d" />
        </>,
      ),
    );
    expect(screen.getByTestId("p").dataset.kind).toBe("pending");
    expect(screen.getByTestId("w").dataset.kind).toBe("waiting");
    expect(screen.getByTestId("d").getAttribute("aria-hidden")).toBe("true");
  });

  it("money keeps its whole string; a column sets its cents in a fixed slot", () => {
    render(wrap(<MoneyFigure display="US$4,273.50" align="decimal" testId="m" />));
    const money = screen.getByTestId("m");
    expect(money.textContent).toBe("US$4,273.50");
    expect(money.querySelector(".fs-money__cents")?.textContent).toBe(".50");
    render(wrap(<MoneyFigure display="US$64.45" raisedPrefix testId="hero" />));
    expect(screen.getByTestId("hero").querySelector(".fs-cur")?.textContent).toBe("US$");
    expect(screen.getByTestId("hero").textContent).toBe("US$64.45");
  });
});

describe("DotMatrix, the shared instrument numeral", () => {
  it("draws 5 × 7 dots a digit and never money; unlit dots are 5%", () => {
    expect(DOT_MATRIX_UNLIT).toBe(0.05);
    expect(drawable("US$4,333.50")).toBe("4333.50");
    const { dots, height } = dotsOf("7/8", 9);
    expect(dots).toHaveLength(15 * 7);
    expect(height).toBe(63);
  });

  it("is an image named by its spoken value, with a tone for a dim or over-limit reading", () => {
    render(wrap(<DotMatrix value="7/8" label="7 of 8 confirmed" tone="over" testId="dm" />));
    const svg = screen.getByRole("img", { name: "7 of 8 confirmed" });
    expect(svg.dataset.tone).toBe("over");
    expect(svg.dataset.value).toBe("7/8");
    expect(svg.querySelectorAll("[data-on]").length).toBeGreaterThan(0);
  });
});
