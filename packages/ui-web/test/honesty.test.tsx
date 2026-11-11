// UI gate round 3: honesty marks with a budget, the shared numeral (no dot-matrix), state dots and the money role.

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import * as uiWeb from "../src/index.js";
import {
  HONESTY,
  HonestyLegend,
  HonestyTag,
  LegendGlyph,
  MicroTag,
  MoneyFigure,
  Numeral,
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
  it("the micro-tag shows 'Simulated' (round 4) and says the whole label to a screen reader and in its tooltip", () => {
    render(wrap(<MicroTag testId="mt" />));
    const tag = screen.getByTestId("mt");
    expect(tag.dataset.fsTag).toBe("micro");
    expect(tag.getAttribute("title")).toBe("Simulated PayPal sandbox");
    const word = tag.querySelector(".fs-microtag__word");
    expect(word?.textContent).toBe("Simulated");
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
  it("pending is a hollow dot, a waiting signer a hollow circle, signed an ink dot, paid the jade dot", () => {
    render(
      wrap(
        <>
          <StateDot kind="pending" testId="p" />
          <StateDot kind="waiting" testId="w" />
          <StateDot kind="done" testId="d" />
          <StateDot kind="paid" testId="paid" />
        </>,
      ),
    );
    expect(screen.getByTestId("p").dataset.kind).toBe("pending");
    expect(screen.getByTestId("w").dataset.kind).toBe("waiting");
    expect(screen.getByTestId("d").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("paid").dataset.kind).toBe("paid");
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

describe("Numeral, a count in FS Sans (round 3: the dot-matrix is gone)", () => {
  it("no dot-matrix is left to import", () => {
    expect(Object.keys(uiWeb).filter((name) => /dot ?matrix|dotsOf|drawable/i.test(name))).toEqual([]);
  });

  it("is text on a type step, named by its spoken value, ink once checked and dim before", () => {
    render(wrap(<Numeral value="7/8" label="7 of 8 confirmed" testId="n" />));
    const count = screen.getByRole("img", { name: "7 of 8 confirmed" });
    expect(count).toBe(screen.getByTestId("n"));
    expect(count.textContent).toBe("7/8");
    expect(count.dataset.value).toBe("7/8");
    expect(count.dataset.tone).toBe("ink");
    expect(count.classList.contains("fs-t-hero")).toBe(true);
    expect(count.querySelector("svg")).toBeNull();
  });

  it("sits on a smaller step when asked, and hides itself when the words beside it say it", () => {
    render(wrap(<Numeral value="0/6" size="title" tone="dim" decorative testId="d" />));
    const count = screen.getByTestId("d");
    expect(count.classList.contains("fs-t-title")).toBe(true);
    expect(count.dataset.tone).toBe("dim");
    expect(count.getAttribute("aria-hidden")).toBe("true");
    expect(count.getAttribute("role")).toBeNull();
  });
});
