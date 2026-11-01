// The console's router: the generated route tree, the data runtime as router context (loaders warm the
// snapshot), and the shell's fallbacks. Tests build one over a memory history.

import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { NotFound, RouteError } from "./chrome/Fallbacks.js";
import type { DataRuntime } from "./data/provider.js";
import { routeTree } from "./routeTree.gen.js";

export interface RouterContext {
  readonly runtime: DataRuntime;
}

export function createConsoleRouter(runtime: DataRuntime, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { runtime },
    history,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
  });
}

export type ConsoleRouter = ReturnType<typeof createConsoleRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: ConsoleRouter;
  }
}
