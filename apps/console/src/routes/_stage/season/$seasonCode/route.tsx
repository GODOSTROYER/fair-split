import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireSeason } from "../../../../lib/route-params.js";

// /season/:seasonCode (register §4): the season label as written, "2026-A". Anything else is a 404.
export const Route = createFileRoute("/_stage/season/$seasonCode")({
  beforeLoad: ({ params }) => requireSeason(params.seasonCode),
  component: Outlet,
});
