import { createFileRoute, redirect } from "@tanstack/react-router";

// /runs/:runSlug on its own opens the run's split review (W-TR-05), so a pasted run address always lands.
export const Route = createFileRoute("/_stage/runs/$runSlug/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/runs/$runSlug/split", params: { runSlug: params.runSlug }, search: {} });
  },
});
