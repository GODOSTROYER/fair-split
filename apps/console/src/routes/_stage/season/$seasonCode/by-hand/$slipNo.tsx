import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../../chrome/Fallbacks.js";
import { requireSlip } from "../../../../../lib/route-params.js";
import { Screen } from "../../../../../screens/W-TR-04/index.js";

// W-TR-04 By hand: one field at a time, slip 0462 in the seed.
export const Route = createFileRoute("/_stage/season/$seasonCode/by-hand/$slipNo")({
  beforeLoad: ({ params }) => requireSlip(params.slipNo),
  component: function ByHandRoute() {
    const { seasonCode, slipNo } = Route.useParams();
    useDocumentTitle(`${SCREENS["W-TR-04"].name}, slip ${slipNo}`);
    return <Screen seasonCode={seasonCode} slipNo={slipNo} />;
  },
});
