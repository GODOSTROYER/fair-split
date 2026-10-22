import { createFileRoute } from "@tanstack/react-router";
import { PrototypeLayout } from "../prototype/Shell.js";
import { parseSearch } from "../prototype/search.js";

// W-DP-01, the gate G1 design prototype (register §4). Unlinked after G5.
export const Route = createFileRoute("/prototype")({
  validateSearch: parseSearch,
  component: PrototypeLayout,
});
