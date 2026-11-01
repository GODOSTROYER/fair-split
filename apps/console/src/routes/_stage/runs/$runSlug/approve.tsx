import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../chrome/Fallbacks.js";
import { Screen } from "../../../../screens/W-TR-07/index.js";

// W-TR-07 Approve: the two keys (MM-5).
export const Route = createFileRoute("/_stage/runs/$runSlug/approve")({
  component: function ApproveRoute() {
    const { runSlug } = Route.useParams();
    useDocumentTitle(SCREENS["W-TR-07"].name);
    return <Screen runSlug={runSlug} />;
  },
});
