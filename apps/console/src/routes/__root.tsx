import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { NotFound, RouteError } from "../chrome/Fallbacks.js";
import { GlobalShortcuts } from "../chrome/GlobalShortcuts.js";
import { useFaceFollows } from "../lib/face.js";
import { useFocusGuard } from "../lib/focus.js";
import type { RouterContext } from "../router.js";

// The root: every surface (stage, Proof, /ops, /sign-in, WS-DS's /prototype) renders in the Outlet. The
// global keys (? and D) and the shortcut sheet (W-TR-10) mount once, here, and so does the focus backstop: a link
// that changes the route takes its screen away with the focus it held, and focus goes on to the new screen.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: function Root() {
    useFaceFollows();
    useFocusGuard();
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
