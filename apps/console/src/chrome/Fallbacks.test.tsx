import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTestRuntime } from "../test/world.js";
import { RunRouteGate } from "./Fallbacks.js";

describe("run visit gate", () => {
  it("hides every amount while the visit resumes", () => {
    const view = render(
      <RunRouteGate data={{ access: "pending" }}>
        <p>US$0.00</p>
      </RunRouteGate>,
    );
    expect(screen.getByRole("status").textContent).toContain("Resuming");
    expect(view.container.textContent).not.toContain("US$");
    expect(view.container.querySelector(".fsc-bed")).toBeTruthy();
  });
  it("explains a run from another visit without exposing figures", () => {
    const view = render(
      <RunRouteGate data={{ access: "missing" }}>
        <p>US$0.00</p>
      </RunRouteGate>,
    );
    expect(screen.getByText("This run belongs to another visit.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a fresh run" }).getAttribute("href")).toBe("/judge");
    expect(screen.getByRole("link", { name: "Open the showcase" })).toBeTruthy();
    expect(view.container.textContent).not.toContain("US$");
  });
  it("ends the existing visit before starting a fresh run", async () => {
    const { runtime } = createTestRuntime();
    await runtime.session.start();
    render(
      <RunRouteGate
        data={{
          access: "missing",
          startFresh: async () => {
            await runtime.session.reset();
            // Hold navigation so this test checks the real Reset without leaving jsdom.
            await new Promise<void>(() => undefined);
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Start a fresh run" }));
    await expect.poll(() => runtime.session.getState().status).toBe("none");
    expect(sessionStorage.getItem("fs.judge.tab")).toBeNull();
  });
});
