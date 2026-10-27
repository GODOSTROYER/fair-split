import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRunSlug } from "../../../../lib/route-params.js";

// /runs/:runSlug (register §4): runSlug = `2026A-r{runSeq}`. Anything else is a 404.
export const Route = createFileRoute("/_stage/runs/$runSlug")({
  beforeLoad: ({ params }) => requireRunSlug(params.runSlug),
  component: Outlet,
});
