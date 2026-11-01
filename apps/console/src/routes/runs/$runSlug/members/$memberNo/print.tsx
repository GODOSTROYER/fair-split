import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../../chrome/Fallbacks.js";
import { Surface } from "../../../../../chrome/Surface.js";
import { snapshotQuery } from "../../../../../data/query.js";
import { requireMember, requireRunSlug } from "../../../../../lib/route-params.js";
import { PrintScreen } from "../../../../../screens/W-TR-09/index.js";

// W-TR-09's 80 mm statement for a cash member (`@page { size: 80mm auto }`). It prints on paper, so it sits
// outside the stage chrome on the daylight surface.
export const Route = createFileRoute("/runs/$runSlug/members/$memberNo/print")({
  beforeLoad: ({ params }) => {
    requireRunSlug(params.runSlug);
    requireMember(params.memberNo);
  },
  loader: ({ context }) => context.runtime.client.ensureQueryData(snapshotQuery(context.runtime.adapter)),
  component: function PrintRoute() {
    const { runSlug, memberNo } = Route.useParams();
    useDocumentTitle(`Statement ${memberNo}`);
    return (
      <Surface theme="adlaw" className="fsc-surface fsc-surface--print">
        <PrintScreen runSlug={runSlug} memberNo={memberNo} />
      </Surface>
    );
  },
});
