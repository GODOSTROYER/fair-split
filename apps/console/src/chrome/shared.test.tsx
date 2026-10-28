// The shared pieces slices build on: the drawer frame (W-TR-06, W-TR-09), Data mode's mirrored tables, command
// notices and print beds. Each one is checked for its behaviour and with axe.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../data/errors.js";
import { DataModeProvider } from "../lib/data-mode.js";
import { ShortcutsProvider } from "../lib/shortcuts.js";
import { expectNoAxeViolations } from "../test/axe.js";
import { CommandNotice } from "./CommandNotice.js";
import { DataTable, Mirrored } from "./DataTable.js";
import { PrintBed } from "./PrintBed.js";
import { StageDrawer } from "./StageDrawer.js";

describe("StageDrawer", () => {
  it("is a labelled region that Close and Escape both end, with focus inside it on open", async () => {
    const onClose = vi.fn();
    render(
      <ShortcutsProvider>
        <main>
          <StageDrawer label="Hold H1" meta="1 of 3" onClose={onClose} testId="W-TR-06.drawer" mode="overlay">
            <p>Slip 0457 is in two photos.</p>
          </StageDrawer>
        </main>
      </ShortcutsProvider>,
    );
    const drawer = screen.getByTestId("W-TR-06.drawer");
    expect(drawer.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Hold H1" })).toBe(drawer);
    expect(drawer.dataset.mode).toBe("overlay");
    // Focus lands on the drawer's title (its name is read out), never a ring around the whole 560 px drawer.
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.activeElement?.textContent).toBe("Hold H1");
    expect(screen.getByTestId("W-TR-06.drawer.scrim")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByTestId("W-TR-06.drawer.close"));
    expect(onClose).toHaveBeenCalledTimes(2);
    await expectNoAxeViolations(document.body);
  });

  it("hands focus back to what opened it on close, reads a new subject's name, and keeps focus when a control goes", async () => {
    function Harness({ open, label, decided }: { open: boolean; label: string; decided: boolean }) {
      return (
        <ShortcutsProvider>
          <button type="button" data-testid="opener">
            Row M-007
          </button>
          {open && (
            <StageDrawer label={label} onClose={() => undefined} testId="W-TR-06.drawer" mode="push">
              {decided ? (
                <a href="#next" data-focus-after="" data-testid="next">
                  Next: hold H2
                </a>
              ) : (
                <button type="button" data-testid="decide">
                  Count it once
                </button>
              )}
            </StageDrawer>
          )}
        </ShortcutsProvider>
      );
    }
    const view = render(<Harness open={false} label="Hold H1" decided={false} />);
    screen.getByTestId("opener").focus();
    view.rerender(<Harness open label="Hold H1" decided={false} />);
    expect(document.activeElement?.textContent).toBe("Hold H1");
    // A decision removes the focused control: focus lands on the drawer's next step, never on <body>.
    screen.getByTestId("decide").focus();
    view.rerender(<Harness open label="Hold H1" decided />);
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("next")));
    // The same drawer moving to another hold reads the new name out.
    view.rerender(<Harness open label="Hold H2" decided />);
    expect(document.activeElement?.textContent).toBe("Hold H2");
    // Closing returns focus to the row that opened it.
    view.rerender(<Harness open={false} label="Hold H2" decided />);
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("opener")));
  });

  it("pushes instead of covering below 1600 px: no scrim", () => {
    render(
      <ShortcutsProvider>
        <StageDrawer label="Line" onClose={() => undefined} testId="W-TR-09.drawer" mode="push">
          <p>Line</p>
        </StageDrawer>
      </ShortcutsProvider>,
    );
    expect(screen.queryByTestId("W-TR-09.drawer.scrim")).toBeNull();
  });
});

describe("Data mode", () => {
  const table = (
    <DataTable
      caption="Mass balance"
      columns={[
        { key: "count", label: "Counted" },
        { key: "shrink", label: "Shrink", numeric: true },
      ]}
      rows={[
        { key: "twice", cells: { count: "0457 twice", shrink: "2.05%" } },
        { key: "once", cells: { count: "0457 once", shrink: "1.62%" } },
      ]}
      testId="W-TR-05.dial.table"
    />
  );

  it("hides the picture from screen readers and keeps its table for them; Data mode swaps them on screen", async () => {
    const view = render(
      <DataModeProvider initial={false}>
        <Mirrored visual={<svg data-testid="dial" />} table={table} testId="W-TR-05.dial" />
      </DataModeProvider>,
    );
    const root = screen.getByTestId("W-TR-05.dial");
    expect(root.querySelector(".fsc-mirrored__visual")?.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector(".fs-sr table")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Mass balance" })).toBeTruthy();
    await expectNoAxeViolations(view.container);
    view.rerender(
      <DataModeProvider initial>
        <Mirrored visual={<svg data-testid="dial" />} table={table} testId="W-TR-05.dial" />
      </DataModeProvider>,
    );
  });

  it("Data mode on: the table is on screen and the visual is hidden", () => {
    render(
      <DataModeProvider initial>
        <Mirrored visual={<svg data-testid="dial" />} table={table} testId="W-TR-05.dial" />
      </DataModeProvider>,
    );
    const root = screen.getByTestId("W-TR-05.dial");
    expect(root.dataset.datamode).toBe("");
    expect(root.querySelector(".fsc-mirrored__visual")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector(".fsc-mirrored__table table")).toBeTruthy();
    expect(document.documentElement.hasAttribute("data-datamode")).toBe(true);
  });
});

describe("CommandNotice", () => {
  it("says what happened in the console's words, with the API's message and the request ID", async () => {
    const error = new ApiClientError(
      {
        code: "HOLD_NOT_OPEN",
        status: 409,
        message: "This hold is already decided.",
        requestId: "req_01JTEST",
      },
      { command: "resolveHold", rail: "simulated", requestId: "req_01JTEST" },
    );
    const retry = vi.fn();
    const view = render(<CommandNotice error={error} testId="W-TR-06.error" onRetry={retry} />);
    const notice = screen.getByTestId("W-TR-06.error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.dataset.tone).toBe("neutral");
    expect(notice.textContent).toMatch(/already decided/);
    expect(notice.textContent).toMatch(/Request req_01JTEST/);
    act(() => screen.getByTestId("W-TR-06.error.retry").click());
    expect(retry).toHaveBeenCalled();
    await expectNoAxeViolations(view.container);
  });

  it("is red only when PayPal is the actor, and renders nothing without an error", () => {
    const paypal = new ApiClientError(
      { code: "PAYPAL_REJECTED", status: 502, message: "PayPal said no.", paypalDebugId: "f00dbabe" },
      { command: "payCash", rail: "simulated", requestId: null },
    );
    const view = render(<CommandNotice error={paypal} testId="W-TR-08.error" />);
    expect(screen.getByTestId("W-TR-08.error").dataset.tone).toBe("paypal");
    expect(screen.getByTestId("W-TR-08.error").textContent).toMatch(/PayPal debug ID f00dbabe/);
    view.rerender(<CommandNotice error={null} testId="W-TR-08.error" />);
    expect(screen.queryByTestId("W-TR-08.error")).toBeNull();
  });
});

describe("PrintBed", () => {
  it("draws decorative beds, labelled for sighted readers only", () => {
    const view = render(<PrintBed shape="photo" labels={["Photo A", "Photo B"]} />);
    const beds = view.container.querySelectorAll(".fsc-bed");
    expect(beds).toHaveLength(2);
    expect([...beds].every((b) => b.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(beds[1]?.textContent).toBe("Photo B");
  });
});
