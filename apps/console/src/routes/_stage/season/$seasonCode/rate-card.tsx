import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../chrome/Fallbacks.js";
import { Screen } from "../../../../screens/W-TR-02/index.js";

// W-TR-02 Rate card.
export const Route = createFileRoute("/_stage/season/$seasonCode/rate-card")({
  component: function RateCardRoute() {
    const { seasonCode } = Route.useParams();
    useDocumentTitle(SCREENS["W-TR-02"].name);
    return <Screen seasonCode={seasonCode} />;
  },
});
