import { webRoutes } from "@fairsplit/contracts";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AppProviders } from "../../../chrome/AppProviders.js";
import type { StreamHandlers } from "../../../data/adapter.js";
import { createDataRuntime } from "../../../data/provider.js";
import { createConsoleRouter } from "../../../router.js";
import { createTestRuntime } from "../../../test/world.js";

it("a renewed visit keeps financial print beds until its delayed history supplies lines", async () => {
  const original = createTestRuntime();
  const session = await original.runtime.session.start();
  original.world.markPaid();
  original.world.resolveAll();
  const history = original.world.eventsAfter(null);
  let stream: StreamHandlers | undefined;
  vi.spyOn(original.adapter, "subscribe").mockImplementation((scope, handlers) => {
    if (scope.kind === "run") stream = handlers;
    handlers.onStatus?.({ kind: "open", since: Date.now() });
    return () => undefined;
  });
  const runtime = createDataRuntime(original.adapter);
  const router = createConsoleRouter(
    runtime,
    createMemoryHistory({
      initialEntries: [webRoutes.approve(session.runSlug)],
    }),
  );
  const rendered = render(
    <AppProviders runtime={runtime} motion="reduced">
      <RouterProvider router={router} />
    </AppProviders>,
  );
  try {
    await waitFor(() => expect(runtime.session.getState().status).toBe("active"));
    await waitFor(() => expect(stream).toBeDefined());
    expect(screen.getByTestId("run-visit.pending")).toBeTruthy();
    expect(document.getElementById("fsc-main")?.textContent).not.toContain("US$0.00");
    const invoice = history.find((event) => event.type === "invoice.state");
    if (!invoice || !stream) throw new Error("the run has no invoice history");
    act(() => stream?.onEvent(invoice));
    expect(screen.getByTestId("run-visit.pending")).toBeTruthy();
    act(() => {
      for (const event of history) stream?.onEvent(event);
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-07.amount").textContent).toContain("368.39"), {
      timeout: 10_000,
    });
    expect(screen.queryByTestId("run-visit.pending")).toBeNull();
  } finally {
    rendered.unmount();
    runtime.hub.closeAll();
    original.runtime.hub.closeAll();
    await runtime.session.reset();
    original.world.dispose();
    vi.restoreAllMocks();
  }
}, 40_000);
