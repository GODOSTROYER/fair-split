import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="grid min-h-dvh place-content-center gap-4 p-8">
      <p className="fs-t-title-2">This page isn’t part of the console yet.</p>
      <Link to="/prototype" className="fs-link">
        Open the design prototype
      </Link>
    </main>
  ),
});
