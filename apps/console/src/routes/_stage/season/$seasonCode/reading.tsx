import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../chrome/Fallbacks.js";
import { readingSearch } from "../../../../lib/route-params.js";
import { Screen } from "../../../../screens/W-TR-03/index.js";

// W-TR-03 Reading room, `?photo=B` names the photo on the bench.
export const Route = createFileRoute("/_stage/season/$seasonCode/reading")({
  validateSearch: readingSearch,
  component: function ReadingRoute() {
    const { seasonCode } = Route.useParams();
    const { photo } = Route.useSearch();
    useDocumentTitle(SCREENS["W-TR-03"].name);
    return <Screen seasonCode={seasonCode} photo={photo} />;
  },
});
