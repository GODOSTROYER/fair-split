// UI gate round 4: ids that never break mid-word, the receipt chip, and avatars that are not indigo.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Avatar, IdText, ReceiptChip, truncateMiddle, UiProvider } from "../src/index.js";

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

describe("truncateMiddle", () => {
  it("keeps a short id whole", () => {
    expect(truncateMiddle("fs-ernesto", 20)).toBe("fs-ernesto");
  });

  it("cuts the middle of a long id, never its ends, with one ellipsis", () => {
    const out = truncateMiddle("fs-ernesto-demo-mj2ng2", 18);
    expect(out.startsWith("fs-ern")).toBe(true);
    expect(out.endsWith("mj2ng2")).toBe(true);
    expect(out).toContain("…");
    expect(out.length).toBeLessThanOrEqual(18);
  });

  it("keeps the tail when asked (a key id's last six say which key)", () => {
    expect(truncateMiddle("fs-analyn-demo-v9kuqr", 17, 6)).toBe("fs-analyn…v9kuqr");
  });
});

describe("IdText", () => {
  it("prints the id in the mono, on one line, middle-truncated, with the whole id as its name and title", () => {
    render(wrap(<IdText value="fs-ernesto-demo-mj2ng2" max={17} tail={6} testId="id" />));
    const id = screen.getByTestId("id");
    expect(id.classList.contains("fs-t-id")).toBe(true);
    expect(id.classList.contains("fs-idtext")).toBe(true);
    expect(id.getAttribute("title")).toBe("fs-ernesto-demo-mj2ng2");
    expect(id.querySelector(".fs-sr")?.textContent).toBe("fs-ernesto-demo-mj2ng2");
    expect(id.querySelector("[aria-hidden]")?.textContent).toBe("fs-ernesto…mj2ng2");
  });

  it("never wraps: the class is nowrap", () => {
    expect(rule(".fs-idtext")).toMatch(/white-space:\s*nowrap/);
  });

  it("clips without becoming a scroll container, so a cut id keeps the line's baseline", () => {
    expect(rule(".fs-idtext")).toMatch(/overflow:\s*clip/);
    expect(rule(".fs-idtext")).not.toMatch(/overflow:\s*hidden/);
  });
});

describe("ReceiptChip", () => {
  it("the serial in the id style, the kilos in ink, flat with a 1 px rule (no evidence red or ballpoint blue)", () => {
    render(wrap(<ReceiptChip serial="0403" kilos="38.45" testId="chip" />));
    const chip = screen.getByTestId("chip");
    expect(chip.querySelector(".fs-receipt-chip__serial")?.classList.contains("fs-t-id")).toBe(true);
    expect(chip.querySelector(".fs-receipt-chip__kg")?.textContent).toBe("38.45");
    const look = rule(".fs-receipt-chip");
    expect(look).toMatch(/border:\s*1px solid var\(--fs-rule\)/);
    expect(look).not.toMatch(/shadow|evidence/);
    expect(rule(".fs-receipt-chip__serial")).toMatch(/var\(--fs-ink-3\)/);
    expect(rule(".fs-receipt-chip__kg")).toMatch(/var\(--fs-ink\)/);
  });
});

describe("Avatar and the stamp (round 4: indigo is for action only)", () => {
  it("an avatar is white with a 1 px ink-2 ring and ink initials", () => {
    render(wrap(<Avatar initials="AS" name="Analyn Sumalinog" testId="av" />));
    const av = screen.getByTestId("av");
    expect(av.classList.contains("fs-avatar")).toBe(true);
    expect(av.getAttribute("role")).toBe("img");
    expect(av.getAttribute("aria-label")).toBe("Analyn Sumalinog");
    const look = rule(".fs-avatar");
    expect(look).toMatch(/background:\s*var\(--fs-plate\)/);
    expect(look).toMatch(/inset 0 0 0 1px var\(--fs-ink-2\)/);
    expect(look).toMatch(/color:\s*var\(--fs-ink\)/);
  });

  it("the ink stamp a decision carries wears the avatar's look, never the indigo slab face", () => {
    const stamp = rule(".fs-stamp");
    expect(stamp).not.toMatch(/slab-chalk/);
    expect(stamp).toMatch(/inset 0 0 0 1px var\(--fs-ink-2\)/);
  });
});
