// UI gate round 5: one marker vocabulary (StateDot, CheckMark, StepNumber, a Swatch only as a legend's key), deduction
// chips without ids ("CBU −1.37", the rule in the title), and paper without a corner glyph.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  CheckMark,
  RuleChip,
  ruleChipTitle,
  StateDot,
  StepNumber,
  Swatch,
  UiProvider,
} from "../src/index.js";

const wrap = (node: ReactNode) => (
  <UiProvider lang="en" motion="full">
    {node}
  </UiProvider>
);

const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("one marker vocabulary (round 5)", () => {
  it("a check is a 16 px line ✓ in ink and its word, never a filled disc", () => {
    render(wrap(<CheckMark testId="c">Matches</CheckMark>));
    const check = screen.getByTestId("c");
    const tick = check.querySelector("svg");
    expect(tick?.getAttribute("width")).toBe("16");
    expect(tick?.getAttribute("aria-hidden")).toBe("true");
    expect(tick?.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(check.textContent).toBe("Matches");
    expect(rule(".fs-check")).toContain("color: var(--fs-ink)");
  });

  it("a chain step is a 24 px outlined circle with an ink numeral", () => {
    render(wrap(<StepNumber n={2} label="Step 2" testId="s" />));
    const step = screen.getByRole("img", { name: "Step 2" });
    expect(step.textContent).toBe("2");
    const decl = rule(".fs-step");
    expect(decl).toContain("width: 24px");
    expect(decl).toContain("box-shadow: inset 0 0 0 1px var(--fs-ink-2)");
    expect(decl).toContain("background: var(--fs-plate)");
    expect(decl).toContain("color: var(--fs-ink)");
  });

  it("a step without words beside it is still named; with words it is hidden", () => {
    render(wrap(<StepNumber n={3} testId="s3" />));
    expect(screen.getByTestId("s3").getAttribute("aria-hidden")).toBe("true");
  });

  it("states are 8 px round dots; 12 px only beside a hero's word", () => {
    render(
      wrap(
        <>
          <StateDot kind="held" testId="d8" />
          <StateDot kind="paid" size={12} testId="d12" />
        </>,
      ),
    );
    expect(screen.getByTestId("d8").dataset.size).toBeUndefined();
    expect(screen.getByTestId("d12").dataset.size).toBe("12");
    expect(rule(".fs-state-dot")).toContain("border-radius: 50%");
    expect(rule('.fs-state-dot[data-size="12"]')).toContain("vertical-align: baseline");
  });

  it("the one square is a legend's key: jade for confirmed money, hatch for cash", () => {
    render(
      wrap(
        <>
          <Swatch kind="paid" testId="p" />
          <Swatch kind="cash" size={12} testId="h" />
        </>,
      ),
    );
    expect(screen.getByTestId("p").dataset.kind).toBe("paid");
    expect(screen.getByTestId("h").dataset.size).toBe("12");
    expect(rule('.fs-swatch[data-kind="paid"]')).toContain("var(--fs-jade)");
    expect(rule('.fs-swatch[data-kind="cash"]')).toContain("var(--fs-hatch)");
    // Round 8: planned money is a solid steel square, never a dashed placeholder.
    expect(rule('.fs-swatch[data-kind="planned"]')).toContain("background: var(--fs-steel-line)");
    expect(rule('.fs-swatch[data-kind="planned"]')).not.toContain("dashed");
  });
});

describe("no ids for people (round 5)", () => {
  it("a deduction chip reads 'CBU −1.37'; the rule is its title and part of its name", () => {
    render(wrap(<RuleChip name="CBU" amount="−1.37" rule="R1" ruleText="CBU 5% of bonus" />));
    const chip = screen.getByRole("img", { name: "CBU −1.37, Rule R1 · CBU 5% of bonus" });
    expect(chip.textContent).toBe("CBU −1.37");
    expect(chip.getAttribute("title")).toBe("Rule R1 · CBU 5% of bonus");
    expect(chip.textContent).not.toContain("R1");
  });

  it("a rule's title without its words is the id alone", () => {
    expect(ruleChipTitle("R5")).toBe("Rule R5");
  });
});
