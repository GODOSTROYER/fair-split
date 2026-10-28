import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { NotFound, RouteError } from "../chrome/Fallbacks.js";
import { GlobalShortcuts } from "../chrome/GlobalShortcuts.js";
import { useFaceFollows } from "../lib/face.js";
import type { RouterContext } from "../router.js";

// The root: every surface (stage, Proof, /ops, /sign-in, WS-DS's /prototype) renders in the Outlet. The
// global keys (? and D) and the shortcut sheet (W-TR-10) mount once, here.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: function Root() {
    useFaceFollows();
    return (
      <>
        <Outlet />
        <GlobalShortcuts />
      </>
    );
  },
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});
