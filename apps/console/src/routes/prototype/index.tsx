import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../../prototype/pages/Overview.js";

export const Route = createFileRoute("/prototype/")({ component: OverviewPage });
