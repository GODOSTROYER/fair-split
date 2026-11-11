// The console's router: the generated route tree, the data runtime as router context (loaders warm the
// snapshot), and the shell's fallbacks. Tests build one over a memory history.

import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { BootShell } from "./chrome/BootShell.js";
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
    // Stage owns its scroller: pathname changes open at the top; hold-only searches keep their offset.
    // Router restoration otherwise copies the last screen's nested scroll position after Stage resets it.
    scrollRestoration: ({ location }) => !/^\/(judge|season|runs)(\/|$)/.test(location.pathname),
    // Round 6: while a route's first loader waits (the stage's seeded snapshot), the boot shell index.html already
    // shows stays up, at once and for no longer than the wait: the page is never a blank ground.
    defaultPendingComponent: BootShell,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
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
