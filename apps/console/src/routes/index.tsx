import { createFileRoute, redirect } from "@tanstack/react-router";

// Until WS-CONSOLE lands the Judge stage at /judge, the root opens the G1 prototype.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/prototype" });
  },
});
