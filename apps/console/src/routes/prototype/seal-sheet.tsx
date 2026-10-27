import { createFileRoute } from "@tanstack/react-router";
import { SealSheetPage } from "../../prototype/pages/SealSheet.js";

// S2 §2.12: 300 seeded seals at 64, 200 and 320 px and the 1-bit print, flagged at gate G1.
export const Route = createFileRoute("/prototype/seal-sheet")({ component: SealSheetPage });
