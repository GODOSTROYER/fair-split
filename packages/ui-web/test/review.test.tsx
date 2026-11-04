// The C7 review round (ADR-0016): what the stylesheet must keep (jsdom applies none, so those checks read
// styles.css's rules by selector) and the live-moment attributes the components set.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Chip, MassBalanceDial, Slab, StatusCapsule, StatusChip, UiProvider } from "../src/index.js";

const wrap = (node: ReactNode) => (
  <UiProvider lang="en" motion="full">
    {node}
  </UiProvider>
);

/** styles.css as flat rules: each selector of a rule's list with its declarations (comments and @-wrappers gone). */
function readRules(): { selector: string; decls: Record<string, string> }[] {
  const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selector: string; decls: Record<string, string> }[] = [];
  const stack: string[] = [];
  let buffer = "";
  for (const ch of css) {
    if (ch === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (ch === "}") {
      const head = stack.pop() ?? "";
      if (!head.startsWith("@") && !stack.some((h) => h.startsWith("@keyframes"))) {
        const decls: Record<string, string> = {};
        for (const part of buffer.split(";")) {
          const i = part.indexOf(":");
          if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
        for (const selector of head.split(/,(?![^(]*\))/)) rules.push({ selector: selector.trim(), decls });
      }
      buffer = "";
    } else buffer += ch;
  }
  return rules;
}

const rules = readRules();
const declared = (selector: string) =>
  rules.filter((r) => r.selector.replace(/\s+/g, " ") === selector).map((r) => r.decls);

describe("the stylesheet after the review", () => {
  it("prints every amount once, solid ink, never in outline (UI gate round 2: one hero numeral)", () => {
    expect(declared(".fs-amount__hollow").map((d) => d.visibility)).toContain("hidden");
    expect(declared(".fs-amount__solid").map((d) => d.color)).toContain("var(--fs-ink)");
    for (const r of rules) {
      expect(r.decls["-webkit-text-stroke"], r.selector).toBeUndefined();
      expect(r.decls["font-family"] ?? "", r.selector).not.toContain("hollow");
    }
  });

  it("one flat primary and one outline secondary: radius 12, 48 px, no lip, no glow, no bolts (round 2)", () => {
    const face = declared(".fs-slab__face")[0];
    expect(face?.["border-radius"]).toBe("var(--fs-radius-control)");
    expect(face?.["min-height"]).toBe("48px");
    expect(face?.["box-shadow"]).toBe("none");
    expect(declared('.fs-slab[data-size="l"] .fs-slab__face')[0]?.["min-height"]).toBe("48px");
    expect(declared(".fs-slab__edge--b").map((d) => d.display)).toContain("none");
    expect(declared(".fs-slab__bolt").map((d) => d.display)).toContain("none");
    const flat = declared(".fs-flat")[0];
    expect(flat?.["border-radius"]).toBe("var(--fs-radius-control)");
    expect(flat?.["box-shadow"]).toBe("none");
    expect(declared('.fs-flat[data-size="l"]')[0]?.["min-height"]).toBe("48px");
    // No coloured blur anywhere in the stylesheet: no shadow names a slab colour.
    for (const r of rules)
      expect(r.decls["box-shadow"] ?? "", r.selector).not.toMatch(/--glow|slab-(jade|chalk)/);
  });

  it("draws the honesty tag as one design: 20 px, dashed steel, ink-3 words, never bold", () => {
    const tag = declared(".fs-honesty")[0];
    expect(tag?.height).toBe("20px");
    expect(tag?.border).toBe("1px dashed var(--fs-steel-line)");
    expect(tag?.color).toBe("var(--fs-ink-3)");
    expect(tag?.["font-weight"]).toBeUndefined();
    expect(tag?.["white-space"]).toBe("nowrap");
  });

  it("keeps the pod focus ring on a committed jade slab and on the selected receipt segment (WCAG 2.4.7)", () => {
    for (const selector of [
      '.fs-slab[data-tone="jade"][data-state="committed"] .fs-slab__face',
      ".fs-receipt__seg[data-active]",
    ]) {
      for (const d of declared(selector)) {
        expect(d.outline, selector).toBeUndefined();
        expect(d["outline-offset"], selector).toBeUndefined();
      }
    }
    const dashed = declared('.fs-slab[data-tone="jade"][data-state="committed"] .fs-slab__face::after');
    expect(dashed.map((d) => d.border)).toContain("1.5px dashed var(--fs-jade-flush-border)");
    const ring = rules.find(
      (r) => r.selector.includes(".fs-slab__face") && r.selector.endsWith(":focus-visible"),
    );
    expect(ring?.decls.outline).toBe("var(--fs-focus-width) solid var(--fs-pod)");
  });

  it("plays the jade halo only on a live flip, never on a chip or capsule that mounted paid", () => {
    const animated = rules.filter((r) => /fs-halo\b/.test(r.decls.animation ?? ""));
    expect(animated.length).toBeGreaterThan(0);
    for (const r of animated) expect(r.selector, r.selector).toContain("[data-flip]");
  });

  it("tags synthetic samples on the yellow copy, with a small radius", () => {
    const tag = declared(".fs-paper__tag")[0];
    expect(tag?.background).toBe("var(--fs-copy-yellow)");
    expect(tag?.["border-radius"]).toBe("4px");
    expect(tag?.["box-shadow"]).toBeUndefined();
  });
});

describe("live moments", () => {
  it("a chip that turns jade while mounted flips once; one that mounted jade does not", () => {
    const { rerender } = render(wrap(<Chip tone="flight">Sending</Chip>));
    const chip = () => document.querySelector<HTMLElement>(".fs-chip");
    expect(chip()?.dataset.flip).toBeUndefined();
    rerender(wrap(<Chip tone="jade">Paid</Chip>));
    expect(chip()?.dataset.flip).toBe("");
    render(wrap(<StatusChip state="PAID" surface="console" testId="past" />));
    expect(screen.getByTestId("past").dataset.tone).toBe("jade");
    expect(screen.getByTestId("past").dataset.flip).toBeUndefined();
  });

  it("a capsule flips when PayPal confirms in view, never when it mounts paid", () => {
    const { rerender } = render(wrap(<StatusCapsule state="sent" text="Gipadala" testId="cap" />));
    expect(screen.getByTestId("cap").dataset.flip).toBeUndefined();
    rerender(wrap(<StatusCapsule state="paid" text="Bayad na" testId="cap" />));
    expect(screen.getByTestId("cap").dataset.flip).toBe("");
    render(wrap(<StatusCapsule state="paid" text="Bayad na" testId="old" />));
    expect(screen.getByTestId("old").dataset.flip).toBeUndefined();
  });
});

describe("Slab detail and trailing", () => {
  it("sets the detail as a second line; the face's text is still the whole string, the keycap hidden", () => {
    render(
      wrap(
        <Slab
          label="Mark Lantern Bay’s invoice paid"
          detail="(simulated PayPal sandbox)"
          trailing={<kbd>Enter</kbd>}
          srLabel="Mark Lantern Bay’s invoice paid (simulated PayPal sandbox)"
          depth="d2"
          tone="chalk"
          testId="press"
          onCommit={() => undefined}
        />,
      ),
    );
    const face = screen.getByTestId("press.face");
    const label = face.querySelector<HTMLElement>(".fs-slab__label");
    expect(label?.dataset.detail).toBe("");
    expect(label?.querySelector(".fs-slab__words")?.textContent).toBe(
      "Mark Lantern Bay’s invoice paid (simulated PayPal sandbox)",
    );
    expect(face.querySelector(".fs-slab__trailing")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: /invoice paid \(simulated PayPal sandbox\)/ })).toBe(face);
  });
});

describe("the dial's reading", () => {
  it("reads at amount-l on the bench and shows the old reading → the new one for the ghost's 1.2 s", () => {
    vi.useFakeTimers();
    try {
      const dial = (value: number, display: string) =>
        wrap(
          <MassBalanceDial
            value={value}
            display={display}
            limitDisplay="Limit ±2.0%"
            label="Mass balance"
            animateNeedle
            valueRole="amount-l"
            testId="dial"
          />,
        );
      const { rerender } = render(dial(2.05, "2.05%"));
      expect(document.querySelector(".fs-dial__value")?.className).toContain("fs-t-amount-l");
      expect(screen.queryByTestId("dial.was")).toBeNull();
      rerender(dial(1.62, "1.62%"));
      expect(screen.getByTestId("dial.was").textContent).toBe("2.05%→");
      expect(screen.getByTestId("dial.ghost")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(screen.queryByTestId("dial.was")).toBeNull();
      expect(screen.queryByTestId("dial.ghost")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
