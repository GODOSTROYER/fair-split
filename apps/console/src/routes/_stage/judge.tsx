import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../chrome/Fallbacks.js";
import { Screen } from "../../screens/W-JG-01/index.js";

// W-JG-01 /judge: the first view renders the seeded showcase with no session and no calls (S3.9).
export const Route = createFileRoute("/_stage/judge")({
  component: function JudgeRoute() {
    useDocumentTitle(SCREENS["W-JG-01"].name);
    return <Screen />;
  },
});
