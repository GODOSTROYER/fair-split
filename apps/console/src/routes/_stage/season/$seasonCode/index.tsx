import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../chrome/Fallbacks.js";
import { Screen } from "../../../../screens/W-TR-01/index.js";

// W-TR-01 Season.
export const Route = createFileRoute("/_stage/season/$seasonCode/")({
  component: function SeasonRoute() {
    const { seasonCode } = Route.useParams();
    useDocumentTitle(`${SCREENS["W-TR-01"].name} ${seasonCode}`);
    return <Screen seasonCode={seasonCode} />;
  },
});
