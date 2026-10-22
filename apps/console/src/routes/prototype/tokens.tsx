import { createFileRoute } from "@tanstack/react-router";
import { TokensPage } from "../../prototype/pages/Tokens.js";

export const Route = createFileRoute("/prototype/tokens")({ component: TokensPage });
