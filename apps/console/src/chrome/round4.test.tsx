// UI gate round 4's shared pieces on the stage: a top bar of six items (Next with Play and the chevron, What's real,
// Proof, the simulated indicator), the run log, sound and Reset in the chevron's menu, the toast in the bar's status
// area (it never covers a row), sheets that start under the bar, one 12-column grid for every screen, and words for
// a farmer or a judge (no camelCase rule names, tool names or file names on screen).

import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describeEvent } from "../data/describe.js";
import { developerWords, refusalTitle, ruleWords, toolWords } from "../lib/plain.js";
import { cascaded, readRules } from "../test/css.js";
import { renderConsole } from "../test/render.js";
import { openStageMenu, queryStageMenuItem, stageMenuItem } from "../test/stage-menu.js";
import { Cell, ScreenHead } from "./ScreenGrid.js";

configure({ asyncUtilTimeout: 6000 });

async function press(testId: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId(`${testId}.face`), { key: "Enter" });
  });
}

describe("words for a farmer or a judge (round 4)", () => {
  it("says each policy rule in plain words; the rule's id stays behind Why", () => {
    expect(ruleWords("invoiceEqualsQuote")).toBe("invoice must equal quote");
    expect(ruleWords("recipientInBrandAllowlist")).toBe("recipient must be the buyer");
    expect(ruleWords("phaseGate")).toBe("not at this step");
    // An id it does not know still reads as words, never camelCase.
    expect(ruleWords("someNewRule")).toBe("some new rule");
  });

  it("titles a refusal by its most telling rule: 'Refused · invoice must equal quote'", () => {
    expect(refusalTitle(["phaseGate", "invoiceEqualsQuote"])).toBe("Refused · invoice must equal quote");
    expect(refusalTitle(["invoiceEqualsQuote"])).toBe("Refused · invoice must equal quote");
    expect(refusalTitle([])).toBe("Refused");
  });

  it("names a tool by what it does", () => {
    expect(toolWords("create_invoice")).toBe("invoice draft");
    expect(toolWords("send_invoice")).toBe("invoice send");
    expect(toolWords("some_tool")).toBe("some tool");
  });

  it("finds developer words in visible text", () => {
    expect(developerWords("Refused · phaseGate · invoiceEqualsQuote")).toEqual([
      "phaseGate",
      "invoiceEqualsQuote",
    ]);
    expect(developerWords("Policy refused create_invoice")).toEqual(["create_invoice"]);
    expect(developerWords("Keys in keys.json")).toEqual(["keys.json"]);
    expect(developerWords("Refused · invoice must equal quote")).toEqual([]);
    expect(developerWords("PayPal · Claude · US$1,000.00 · 2026-A · r37")).toEqual([]);
  });
});

describe("the top bar keeps six items (round 4)", () => {
  it("Next, Play and the chevron in the centre; What's real, Proof and the indicator on the right", async () => {
    await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    const bar = screen.getByTestId("W-JG-01.bar");
    // Log, sound and Reset are in the chevron's menu, never in the bar.
    for (const id of ["W-JG-01.logOpen", "W-JG-01.sound", "W-JG-01.reset"]) {
      expect(within(bar).queryByTestId(id)).toBeNull();
    }
    expect(within(bar).getByTestId("W-JG-01.whatsRealOpen")).toBeTruthy();
    expect(within(bar).getByTestId("W-JG-01.notice").textContent).toBe("Simulated PayPal sandbox");
    // Controls in the bar: Next, Play (the slice's), the chevron, What's real and Proof (the indicator is words).
    expect(bar.querySelectorAll("a[href], button").length).toBeLessThanOrEqual(6);
    // The grey status segment is gone; its word is still spoken (it never overclaims).
    const state = screen.getByTestId("W-JG-01.runPill.state");
    expect(state.classList.contains("fs-sr")).toBe(true);
    const popup = await openStageMenu();
    expect(within(popup).getByTestId("W-JG-01.logOpen")).toBeTruthy();
    expect(within(popup).getByTestId("W-JG-01.sound")).toBeTruthy();
    expect(within(popup).getByTestId("W-JG-01.reset")).toBeTruthy();
  });

  it("offers Reset only while there is a session to end; the log and sound always", async () => {
    await renderConsole({ path: "/judge" });
    expect(await queryStageMenuItem("W-JG-01.reset")).toBeNull();
    expect(await queryStageMenuItem("W-JG-01.logOpen")).toBeTruthy();
    const sound = await stageMenuItem("W-JG-01.sound");
    expect(sound.getAttribute("aria-checked")).toBe("false");
  });

  it("the run log opens from the menu", async () => {
    await renderConsole({ path: "/judge" });
    const item = await stageMenuItem("W-JG-01.logOpen");
    await act(async () => {
      fireEvent.click(item);
    });
    expect(await screen.findByTestId("W-JG-01.log")).toBeTruthy();
  });

  it("the toast lives in the bar's status area, so it never sits over a row", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    act(() => {
      view.world.settle();
    });
    await screen.findByTestId("W-JG-01.toast");
    // Each new event re-keys the toast: read the one on screen now.
    await waitFor(() => {
      const toast = screen.getByTestId("W-JG-01.toast");
      expect(screen.getByTestId("W-JG-01.bar").contains(toast)).toBe(true);
      expect(toast.parentElement?.classList.contains("fsc-bar__status")).toBe(true);
    });
  });
});

/** A detached element with these classes, for the cascade helper. */
function el(className: string): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

describe("nothing covers content (round 4)", () => {
  const stage = readRules("src/theme/stage.css");
  const sheets = readRules("src/theme/sheets.css");
  const at = (width: number) => ({ width, height: 1080, motion: "full" as const });

  it("every sheet (What's real, the log, shortcuts) starts under the top bar on a desktop", () => {
    expect(cascaded(sheets, el("fsc-sheet"), "top", at(1920))).toBe("var(--fsc-stage-top)");
    expect(cascaded(stage, document.documentElement, "--fsc-stage-top", at(1920))).toBe(
      "calc(var(--fsc-stage-gutter) * 2 + var(--fs-console-bar))",
    );
    // A phone visit has no stage bar to clear: the sheet takes the screen.
    expect(cascaded(sheets, el("fsc-sheet"), "top", at(390))).toBe("0");
  });

  it("the toast sits in the bar, never absolutely over the screen", () => {
    const position = cascaded(stage, el("fsc-toast"), "position", at(1920));
    expect(position).not.toBe("absolute");
    expect(position).not.toBe("fixed");
  });

  it("the bar is the token's 56 px, so the sheets' offset is exact", () => {
    expect(cascaded(stage, el("fsc-bar"), "min-height", at(1920))).toBe("var(--fs-console-bar)");
  });
});

describe("one 12-column grid (round 4)", () => {
  const grid = readRules("src/theme/grid.css");
  const at = (width: number) => ({ width, height: 1080, motion: "full" as const });

  it("a screen is twelve columns, top-aligned, 32 px under its title row", () => {
    const node = el("fsc-screen");
    const prop = (p: string) => cascaded(grid, node, p, at(1920));
    expect(prop("grid-template-columns")).toBe("repeat(var(--fs-console-columns), minmax(0, 1fr))");
    expect(prop("column-gap")).toBe("var(--fs-console-gutter)");
    expect(prop("row-gap")).toBe("var(--fs-console-head-gap)");
    expect(prop("align-content")).toBe("start");
    expect(prop("align-items")).toBe("start");
  });

  it("Cell and ScreenHead print their spans and the head's id line", () => {
    render(
      <div className="fsc-screen">
        <ScreenHead title="Approve" titleId="t" meta="2026-A · r2" />
        <Cell span={7} spanMd={12} testId="c">
          x
        </Cell>
      </div>,
    );
    const cell = screen.getByTestId("c");
    expect(cell.dataset.span).toBe("7");
    expect(cell.dataset.spanMd).toBe("12");
    expect(screen.getByRole("heading", { name: "Approve" }).id).toBe("t");
    expect(screen.getByText("2026-A · r2").classList.contains("fs-t-id")).toBe(true);
  });
});

describe("the log speaks plain words (round 4)", () => {
  it("a policy refusal reads 'Refused · <rule in words>', the rule ids only in the row's detail", () => {
    const row = describeEvent(
      {
        type: "policy.verdict",
        id: "e1",
        seq: 1,
        at: "2026-11-01T05:20:00Z",
        runId: "r",
        provenance: "live",
        actor: { kind: "agent" },
        payload: { tool: "create_invoice", verdict: "DENY", decidedBy: ["phaseGate", "invoiceEqualsQuote"] },
      } as never,
      {
        memberName: (no: string) => no,
        personName: (id: string) => id,
        itemAmount: () => null,
        recordedOn: "29 Oct",
      },
    );
    expect(row?.words).toBe("Refused · invoice must equal quote");
    expect(developerWords(row?.words ?? "")).toEqual([]);
  });
});
