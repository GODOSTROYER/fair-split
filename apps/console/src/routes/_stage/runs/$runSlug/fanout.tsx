import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../chrome/Fallbacks.js";
import { Screen } from "../../../../screens/W-TR-08/index.js";

// W-TR-08 Run: the honest fan-out and the three-lane log (MM-6).
export const Route = createFileRoute("/_stage/runs/$runSlug/fanout")({
  component: function FanoutRoute() {
    const { runSlug } = Route.useParams();
    useDocumentTitle(SCREENS["W-TR-08"].name);
    return <Screen runSlug={runSlug} />;
  },
});
