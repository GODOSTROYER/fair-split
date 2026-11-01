import { createFileRoute, redirect } from "@tanstack/react-router";

// The console opens on the Judge stage (W-JG-01).
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/judge" });
  },
});
