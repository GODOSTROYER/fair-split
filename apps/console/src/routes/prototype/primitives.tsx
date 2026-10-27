import { createFileRoute } from "@tanstack/react-router";
import { PrimitivesPage } from "../../prototype/pages/Primitives.js";

export const Route = createFileRoute("/prototype/primitives")({ component: PrimitivesPage });
