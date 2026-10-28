// renderConsole: the whole console as a test sees it. The real route tree over a memory history, the real
// providers (data runtime, ui-web settings, announcer, shortcuts, Data mode, chrome slots), and a mock world
// over the seed behind the in-memory adapter, so every route renders in every state with no network.

import type { MotionPreference } from "@fairsplit/ui-web";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, type RenderResult, render, waitFor } from "@testing-library/react";
import type { RequestHandler } from "msw";
import { AppProviders } from "../chrome/AppProviders.js";
import type { DataAdapter } from "../data/adapter.js";
import type { DataRuntime } from "../data/provider.js";
import type { JudgeSession } from "../data/session.js";
import { type ConsoleRouter, createConsoleRouter } from "../router.js";
import { setViewport } from "./viewport.js";
import { createTestRuntime, createTestWorld, type TestWorld } from "./world.js";

export interface RenderConsoleOptions {
  /** Where the console opens (default `/judge`). */
  readonly path?: string;
  /** The world behind the API; a fresh one over the seed by default. */
  readonly world?: TestWorld;
  /** The motion renderer (default "full"; pass "reduced" for the reduced variants). */
  readonly motion?: MotionPreference;
  /** Window size before the first render (S1.6 layouts); default 1470 × 956. */
  readonly viewport?: { readonly width: number; readonly height?: number };
  /** msw handlers answered before the world's, from the first request on (see createTestRuntime). */
  readonly handlers?: readonly RequestHandler[];
}

export interface RenderedConsole extends RenderResult {
  readonly router: ConsoleRouter;
  readonly runtime: DataRuntime;
  readonly adapter: DataAdapter;
  readonly world: TestWorld;
  /** Navigates like a link would and waits for the route to settle. */
  navigate(path: string): Promise<void>;
  /** The first press: starts a judge session (createJudgeSession) and waits until the stage shows it. */
  startSession(): Promise<JudgeSession>;
}

async function settled(router: ConsoleRouter): Promise<void> {
  await waitFor(() => {
    if (router.state.status !== "idle" || router.state.isLoading)
      throw new Error("the router is still loading");
  });
}

export async function renderConsole(options: RenderConsoleOptions = {}): Promise<RenderedConsole> {
  if (options.viewport) setViewport(options.viewport.width, options.viewport.height);
  const { runtime, adapter, world } = createTestRuntime(options.world ?? createTestWorld(), options.handlers);
  const history = createMemoryHistory({ initialEntries: [options.path ?? "/judge"] });
  const router = createConsoleRouter(runtime, history);
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(
      <AppProviders runtime={runtime} motion={options.motion ?? "full"}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  });
  await settled(router);
  const rendered = result as RenderResult;
  return {
    ...rendered,
    router,
    runtime,
    adapter,
    world,
    async navigate(path: string) {
      await act(async () => {
        await router.navigate({ to: path });
      });
      await settled(router);
    },
    async startSession() {
      let session: JudgeSession | undefined;
      await act(async () => {
        session = await runtime.session.start();
      });
      return session as JudgeSession;
    },
  };
}
